import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as tar from 'tar';
import { TarValidator } from './tar-validator.js';
import {
  CloudPanelManifest,
  CloudPanelSource,
  CloudPanelSiteManifest,
  CloudPanelDbManifest,
  CloudPanelCronManifest,
  CloudPanelSshFtpUsersManifest,
  CloudPanelSslManifest,
  CloudPanelVhostLocation,
  CloudPanelSourceType
} from './types.js';

export interface InspectOptions {
  sourceType: CloudPanelSourceType;
  filePath: string;
  dbDumpFilePath?: string;
  expectedSizeBytes?: number;
  tempWorkingDir?: string;
}

export class TarInspector {
  public static calculateSha256(filePath: string): string {
    const fileBuffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(fileBuffer).digest('hex');
  }

  public static async inspect(options: InspectOptions): Promise<CloudPanelManifest> {
    const { sourceType, filePath, dbDumpFilePath, expectedSizeBytes } = options;

    if (!fs.existsSync(filePath)) {
      throw new Error(`Import source file '${filePath}' not found`);
    }

    // Step 1: Validate Tar Archive if it's a tar or tar.gz
    const isGz = filePath.endsWith('.gz') || filePath.endsWith('.tgz');
    if (!isGz && (sourceType === 'backup_tar' || filePath.endsWith('.tar'))) {
      const valResult = await TarValidator.validate(filePath, expectedSizeBytes);
      if (!valResult.valid) {
        throw new Error(valResult.error || 'Tar validation failed');
      }
    }

    const stat = fs.statSync(filePath);
    const sha256 = TarInspector.calculateSha256(filePath);
    const fileName = path.basename(filePath);

    // Prepare temp inspection directory
    const tempRoot = options.tempWorkingDir || path.resolve(process.cwd(), 'data/imports/temp-inspect-' + Date.now());
    fs.mkdirSync(tempRoot, { recursive: true });

    try {
      const entries: string[] = [];
      let totalFilesSize = 0;
      let totalFileCount = 0;

      // Extract entire or partial archive for inspection
      await tar.x({
        file: filePath,
        cwd: tempRoot,
        onentry: (entry) => {
          const p = entry.path.replace(/\\/g, '/');
          entries.push(p);
          if (entry.type === 'File') {
            totalFileCount++;
            totalFilesSize += entry.size || 0;
          }
        }
      });

      // 1. Detect Domain
      let detectedDomain = 'example.com';
      let aliases: string[] = [];
      let vhostRelPath: string | undefined;

      // Look for vhost file: home/*/conf/nginx/*.conf or etc/nginx/sites-available/*.conf
      const vhostCandidate = entries.find(
        (e) => (e.includes('/conf/nginx/') || e.includes('nginx/sites-')) && e.endsWith('.conf')
      );
      if (vhostCandidate) {
        vhostRelPath = vhostCandidate;
        const confContent = fs.readFileSync(path.resolve(tempRoot, vhostCandidate), 'utf8');
        const serverNameMatch = confContent.match(/server_name\s+([^;]+);/i);
        if (serverNameMatch) {
          const names = serverNameMatch[1].trim().split(/\s+/).filter(Boolean);
          if (names.length > 0) {
            detectedDomain = names[0];
            aliases = names.slice(1);
          }
        }
      }

      // If domain still not found, check htdocs/<domain>
      if (detectedDomain === 'example.com') {
        const htdocsMatch = entries.find((e) => e.match(/htdocs\/([^/]+)/));
        if (htdocsMatch) {
          const m = htdocsMatch.match(/htdocs\/([^/]+)/);
          if (m && m[1] && !m[1].includes('.') === false) {
            detectedDomain = m[1];
          }
        }
      }

      // 2. Detect Site Type & Evidence
      let siteType: CloudPanelSiteManifest['type'] = 'php';
      let typeConfidence: CloudPanelSiteManifest['typeConfidence'] = 'medium';
      const typeEvidence: string[] = [];

      const hasWpConfig = entries.some((e) => e.endsWith('wp-config.php'));
      const hasWpContent = entries.some((e) => e.includes('wp-content'));
      const hasComposer = entries.some((e) => e.endsWith('composer.json'));
      const hasArtisan = entries.some((e) => e.endsWith('artisan'));
      const hasPackageJson = entries.some((e) => e.endsWith('package.json'));
      const hasRequirements = entries.some((e) => e.endsWith('requirements.txt'));
      const hasManagePy = entries.some((e) => e.endsWith('manage.py'));

      if (hasWpConfig || hasWpContent) {
        siteType = 'wordpress';
        typeConfidence = 'high';
        if (hasWpConfig) typeEvidence.push(`htdocs/${detectedDomain}/wp-config.php found`);
        if (hasWpContent) typeEvidence.push('wp-content/ present');
      } else if (hasArtisan && hasComposer) {
        siteType = 'php';
        typeConfidence = 'high';
        typeEvidence.push('Laravel artisan found', 'composer.json present');
      } else if (hasPackageJson) {
        siteType = 'nodejs';
        typeConfidence = 'high';
        typeEvidence.push('package.json found');
      } else if (hasRequirements || hasManagePy) {
        siteType = 'python';
        typeConfidence = 'high';
        typeEvidence.push('Python application files found');
      } else if (entries.some((e) => e.endsWith('.html') || e.endsWith('.htm')) && !entries.some((e) => e.endsWith('.php'))) {
        siteType = 'static';
        typeConfidence = 'high';
        typeEvidence.push('Static HTML files found without PHP scripts');
      }

      // 3. Detect PHP Version
      let phpVersionDetected = '8.3';
      let phpVersionSource = 'NexPanel fresh install default';

      if (vhostRelPath) {
        const confContent = fs.readFileSync(path.resolve(tempRoot, vhostRelPath), 'utf8');
        const phpMatch = confContent.match(/php([78]\.[0-9]+)-fpm/i);
        if (phpMatch) {
          phpVersionDetected = phpMatch[1];
          phpVersionSource = `vhost fastcgi_pass php${phpVersionDetected}-fpm`;
        }
      }

      // Check .php-version file
      const phpVerFile = entries.find((e) => e.endsWith('.php-version'));
      if (phpVerFile) {
        try {
          const v = fs.readFileSync(path.resolve(tempRoot, phpVerFile), 'utf8').trim();
          if (v) {
            phpVersionDetected = v.substring(0, 3);
            phpVersionSource = '.php-version file';
          }
        } catch {}
      }

      // 4. Vhost Parsing
      let vhostRoot = `/home/${detectedDomain.replace(/[^a-zA-Z0-9]/g, '')}/htdocs/${detectedDomain}`;
      let vhostIndex = 'index.php index.html';
      let clientMaxBodySize = '64m';
      const customLocations: CloudPanelVhostLocation[] = [];

      if (vhostRelPath) {
        const confContent = fs.readFileSync(path.resolve(tempRoot, vhostRelPath), 'utf8');
        const rootMatch = confContent.match(/root\s+([^;]+);/i);
        if (rootMatch) vhostRoot = rootMatch[1].trim();

        const indexMatch = confContent.match(/index\s+([^;]+);/i);
        if (indexMatch) vhostIndex = indexMatch[1].trim();

        const bodySizeMatch = confContent.match(/client_max_body_size\s+([^;]+);/i);
        if (bodySizeMatch) clientMaxBodySize = bodySizeMatch[1].trim();

        const locationMatches = confContent.matchAll(/location\s+([^{]+)\{/g);
        for (const loc of locationMatches) {
          const locPath = loc[1].trim();
          if (locPath !== '/' && !locPath.includes('.php')) {
            customLocations.push({
              path: locPath,
              note: 'carried over as a snippet — review in mapping'
            });
          }
        }
      }

      // 5. Detect Databases and credentials
      const databases: CloudPanelDbManifest[] = [];
      let wpDbUser = 'wp_example_user';
      let wpDbName = 'wp_example';

      // Read wp-config.php if present
      const wpConfigEntry = entries.find((e) => e.endsWith('wp-config.php'));
      if (wpConfigEntry) {
        try {
          const wpConfigContent = fs.readFileSync(path.resolve(tempRoot, wpConfigEntry), 'utf8');
          const nameMatch = wpConfigContent.match(/define\(\s*['"]DB_NAME['"]\s*,\s*['"]([^'"]+)['"]\s*\)/);
          const userMatch = wpConfigContent.match(/define\(\s*['"]DB_USER['"]\s*,\s*['"]([^'"]+)['"]\s*\)/);
          if (nameMatch) wpDbName = nameMatch[1];
          if (userMatch) wpDbUser = userMatch[1];
        } catch {}
      }

      // Look for SQL dump in backup.tar backups/ folder
      const sqlDumpEntries = entries.filter((e) => e.includes('backups/') && (e.endsWith('.sql.gz') || e.endsWith('.sql')));

      if (sqlDumpEntries.length > 0) {
        for (const dumpEntry of sqlDumpEntries) {
          const dumpStat = fs.statSync(path.resolve(tempRoot, dumpEntry));
          const base = path.basename(dumpEntry);
          const dbNameGuess = base.split('-')[0].replace(/\.sql(\.gz)?$/, '') || wpDbName;

          databases.push({
            name: dbNameGuess,
            dumpFile: dumpEntry,
            dumpSizeBytes: dumpStat.size,
            dumpDate: new Date(dumpStat.mtimeMs).toISOString(),
            engineDetected: 'mysql',
            engineVersionDetected: '8.4',
            userDetected: wpDbUser,
            userSource: 'wp-config.php DB_USER',
            warning:
              'DB password is NOT in the backup — a new password will be generated and wp-config.php rewritten (old file kept as wp-config.php.bak).'
          });
        }
      } else if (dbDumpFilePath && fs.existsSync(dbDumpFilePath)) {
        // Local pair mode: separate DB dump
        const dumpStat = fs.statSync(dbDumpFilePath);
        databases.push({
          name: wpDbName,
          dumpFile: path.basename(dbDumpFilePath),
          dumpSizeBytes: dumpStat.size,
          dumpDate: new Date(dumpStat.mtimeMs).toISOString(),
          engineDetected: 'mysql',
          engineVersionDetected: '8.4',
          userDetected: wpDbUser,
          userSource: 'wp-config.php DB_USER / local pair',
          warning:
            'DB password is NOT in the backup — a new password will be generated and wp-config.php rewritten (old file kept as wp-config.php.bak).'
        });
      }

      // 6. Cron jobs
      const cronManifest: CloudPanelCronManifest = {
        found: false,
        warning:
          "Cron jobs are NOT in a backup.tar — they live in CloudPanel's panel DB / /etc/cron.d/clp. Re-add them manually, or use Live SSH import to detect them."
      };

      // 7. SSH/FTP users
      const sshFtpUsers: CloudPanelSshFtpUsersManifest = {
        found: false,
        note: 'Site-user SSH keys are excluded from remote backups (.ssh is excluded). Re-add keys after import, or use Live SSH import.'
      };

      // 8. SSL
      const sslManifest: CloudPanelSslManifest = {
        found: false,
        note: "Let's Encrypt certs are not in the backup. The importer will re-issue via NPM after DNS points at this server, or import a custom cert if you upload one."
      };

      // Warnings
      const warnings: string[] = [];
      if (phpVersionDetected !== '8.3') {
        warnings.push(
          `PHP ${phpVersionDetected} detected — NexPanel will map it to ${phpVersionDetected} if the image is available, otherwise 8.3 (change in Mapping).`
        );
      }
      if (!cronManifest.found) {
        warnings.push('Cron not in backup (see above).');
      }
      if (customLocations.length > 0) {
        warnings.push(`${customLocations.length} custom vhost location block will be carried over as a snippet — review it in Mapping.`);
      }

      const manifest: CloudPanelManifest = {
        manifestVersion: '1.0',
        source: {
          type: sourceType,
          fileName,
          sha256,
          sizeBytes: stat.size,
          detectedAt: new Date().toISOString(),
          cloudPanelVersion: '2.5.4'
        },
        site: {
          domain: detectedDomain,
          aliases,
          type: siteType,
          typeConfidence,
          typeEvidence,
          phpVersionDetected,
          phpVersionSource,
          documentRoot: `htdocs/${detectedDomain}`,
          vhostFile: vhostRelPath,
          vhost: {
            root: vhostRoot,
            index: vhostIndex,
            clientMaxBodySize,
            customLocations
          },
          fileCount: totalFileCount,
          filesSizeBytes: totalFilesSize
        },
        databases,
        cron: cronManifest,
        sshFtpUsers,
        ssl: sslManifest,
        excludesInBackup: ['.ssh', 'logs', 'tmp'],
        warnings,
        mappingDefaults: {
          domain: detectedDomain,
          phpVersion: phpVersionDetected,
          dbEngine: 'internal-mysql',
          sslMode: 'letsencrypt-http01-after-dns-cutover',
          searchReplace: null
        }
      };

      return manifest;
    } finally {
      // Clean up temp directory
      try {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      } catch {}
    }
  }
}
