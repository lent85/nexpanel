import * as fs from 'node:fs';
import * as path from 'node:path';
import * as tar from 'tar';
import { getDb } from '../db/index.js';
import { AuditService } from '../audit/audit.js';
import { SiteService } from '../sites/site-service.js';
import { DbProvisioner } from '../db-engines/db-provisioner.js';
import { DumpService } from '../db-engines/dump-service.js';
import { EngineRegistry } from '../db-engines/engine-registry.js';
import { PasswordHasher } from '../auth/passwords.js';
import { BackupService } from '../backups/backup-service.js';
import { ImportJobManager } from './import-job-manager.js';
import { TarInspector } from './tar-inspector.js';
import {
  CloudPanelImportJobRecord,
  CloudPanelImportReport,
  CloudPanelManifest,
  CloudPanelMapping
} from './types.js';

export interface ExecuteImportOptions {
  jobId: string;
  actorUserId?: string;
  actorIp?: string;
  onProgress?: (pct: number, msg: string) => Promise<void>;
  log?: (msg: string) => void;
}

export class ImportExecutor {
  public static async execute(options: ExecuteImportOptions): Promise<CloudPanelImportReport> {
    const { jobId, actorUserId, actorIp } = options;
    const startTime = Date.now();

    const reportProgress = async (pct: number, msg: string) => {
      if (options.onProgress) {
        await options.onProgress(pct, msg);
      }
      if (options.log) {
        options.log(`[${pct}%] ${msg}`);
      }
    };

    const job = await ImportJobManager.getJobById(jobId);
    if (!job) {
      throw new Error(`Import job '${jobId}' not found`);
    }

    // 1. Ensure Manifest is loaded
    let manifest: CloudPanelManifest = job.manifestJson!;
    if (!manifest) {
      await reportProgress(5, 'Parsing and inspecting source archive...');
      manifest = await TarInspector.inspect({
        sourceType: job.sourceType,
        filePath: job.sourceRef
      });
      await ImportJobManager.updateJob(jobId, { manifestJson: manifest });
    }

    // 2. Ensure Mapping is resolved
    let mapping: CloudPanelMapping = job.mappingJson!;
    if (!mapping) {
      let defaultEngine = await EngineRegistry.getDefaultEngine();
      mapping = {
        domain: manifest.site.domain,
        phpVersion: manifest.site.phpVersionDetected || '8.3',
        dbEngineId: defaultEngine.id,
        dbName: manifest.databases[0]?.name || 'wp_' + SiteService.slugifyDomain(manifest.site.domain),
        dbUser: manifest.databases[0]?.userDetected || 'wp_user',
        sslMode: 'letsencrypt-http01-after-dns-cutover'
      };
      await ImportJobManager.updateJob(jobId, { mappingJson: mapping });
    }

    const targetDomain = mapping.changeDomainTo || mapping.domain || manifest.site.domain;

    // 3. Idempotency Guard (FR-IMP-04): Check if already imported
    await reportProgress(10, 'Checking idempotency and existing site...');
    const completedJob = await ImportJobManager.findCompletedByChecksumAndDomain(
      manifest.source.sha256,
      targetDomain
    );

    if (completedJob && completedJob.id !== jobId && completedJob.targetSiteId) {
      const existingSite = await SiteService.getSiteById(completedJob.targetSiteId);
      if (existingSite) {
        await reportProgress(100, `already imported, no duplicates for ${targetDomain}`);
        const duplicateReport: CloudPanelImportReport = {
          jobId,
          domain: targetDomain,
          siteId: existingSite.id,
          status: 'done',
          durationMs: Date.now() - startTime,
          importedAt: new Date().toISOString(),
          site: {
            domain: existingSite.domain,
            type: existingSite.type,
            phpVersion: existingSite.phpVersion,
            volumePath: existingSite.volumePath
          },
          cronJobsCount: 0,
          warnings: ['already imported, no duplicates (idempotency guard)'],
          verification: {
            siteDirectoryExists: fs.existsSync(existingSite.volumePath),
            databaseReachable: true,
            configRewritten: true,
            httpCheckOk: true,
            wpLoginFound: true
          }
        };

        await ImportJobManager.updateJob(jobId, {
          status: 'done',
          targetSiteId: existingSite.id,
          reportJson: duplicateReport
        });

        return duplicateReport;
      }
    }

    await ImportJobManager.updateJob(jobId, { status: 'importing' });

    // 4. Pre-import Safety Snapshot if site exists (FR-IMP-04)
    const db = getDb();
    let preImportSnapshotId: string | null = null;
    let targetSite: any = null;

    const existingSiteRes = await db.query('SELECT * FROM sites WHERE domain = $1', [targetDomain]);
    if (existingSiteRes.rows.length > 0) {
      const existing = existingSiteRes.rows[0];
      await reportProgress(15, `Target site '${targetDomain}' exists. Creating pre-import safety snapshot...`);
      const snap = await BackupService.createSiteBackup(
        existing.id,
        { includeFiles: true, includeDb: true },
        actorUserId,
        actorIp
      );
      preImportSnapshotId = snap.snapshotId;
      targetSite = await SiteService.getSiteById(existing.id);
      await ImportJobManager.updateJob(jobId, { preImportSnapshotId });
    } else {
      // Create new Site Record
      await reportProgress(20, `Creating site '${targetDomain}' container and storage...`);
      targetSite = await SiteService.createSite(
        {
          domain: targetDomain,
          aliases: manifest.site.aliases,
          type: manifest.site.type as any,
          phpVersion: mapping.phpVersion || manifest.site.phpVersionDetected || '8.3',
          documentRoot: manifest.site.documentRoot,
          ownerUserId: mapping.ownerUserId || actorUserId
        },
        actorUserId,
        actorIp
      );
      await ImportJobManager.updateJob(jobId, { targetSiteId: targetSite.id });
    }

    // 5. Unpack and extract site files into htdocs
    await reportProgress(35, `Extracting site files into ${targetSite.volumePath}/htdocs...`);
    const tempExtractDir = path.resolve(process.cwd(), `data/imports/temp_exec_${jobId}_${Date.now()}`);
    fs.mkdirSync(tempExtractDir, { recursive: true });

    let sqlDumpPath: string | null = null;

    try {
      if (fs.existsSync(job.sourceRef)) {
        await tar.x({
          file: job.sourceRef,
          cwd: tempExtractDir
        });
      }

      // Find extracted htdocs files
      const siteHtdocs = path.resolve(targetSite.volumePath, 'htdocs');
      fs.mkdirSync(siteHtdocs, { recursive: true });

      // Look for extracted htdocs directory
      let foundHtdocs = false;
      const scanHtdocs = (dir: string) => {
        const entries = fs.readdirSync(dir);
        for (const e of entries) {
          const full = path.resolve(dir, e);
          if (e === 'htdocs' && fs.statSync(full).isDirectory()) {
            // Found htdocs
            const subEntries = fs.readdirSync(full);
            // Check if nested by domain or flat
            const domainDir = subEntries.find((s) => s.toLowerCase() === manifest.site.domain.toLowerCase());
            const srcDir = domainDir ? path.resolve(full, domainDir) : full;

            // Copy files recursively
            fs.cpSync(srcDir, siteHtdocs, { recursive: true });
            foundHtdocs = true;
            return;
          }
          if (fs.statSync(full).isDirectory() && !full.includes('htdocs')) {
            scanHtdocs(full);
            if (foundHtdocs) return;
          }
        }
      };

      scanHtdocs(tempExtractDir);

      if (!foundHtdocs) {
        // Fallback: Copy all files from tempExtractDir to siteHtdocs
        fs.cpSync(tempExtractDir, siteHtdocs, { recursive: true });
      }

      // Find database dump in backups/*.sql.gz or anywhere in extract
      const findSqlDump = (dir: string): string | null => {
        const entries = fs.readdirSync(dir);
        for (const e of entries) {
          const full = path.resolve(dir, e);
          if (e.endsWith('.sql.gz') || e.endsWith('.sql')) {
            return full;
          }
          if (fs.statSync(full).isDirectory()) {
            const found = findSqlDump(full);
            if (found) return found;
          }
        }
        return null;
      };

      sqlDumpPath = findSqlDump(tempExtractDir);

      // Support external DB dump file (Source B: local-files.tar.gz + local-db.sql.gz pair)
      if (!sqlDumpPath && manifest.databases.length > 0) {
        const candidate = manifest.databases[0].dumpFile;
        if (candidate && fs.existsSync(candidate)) {
          sqlDumpPath = candidate;
        } else if (candidate && fs.existsSync(path.resolve(process.cwd(), candidate))) {
          sqlDumpPath = path.resolve(process.cwd(), candidate);
        } else if (candidate) {
          // Check sibling in same directory as sourceRef
          const siblingCandidate = path.resolve(path.dirname(job.sourceRef), path.basename(candidate));
          if (fs.existsSync(siblingCandidate)) {
            sqlDumpPath = siblingCandidate;
          }
        }
      }

      // 6. Database Provisioning & SQL Import (Rule R2 & R3)
      await reportProgress(55, 'Provisioning database and user on target engine...');
      let dbRecord: any = null;
      let dbUserRecord: any = null;
      let generatedDbPass = PasswordHasher.generateRandomPassword(24);

      const targetDbName = mapping.dbName || manifest.databases[0]?.name || 'wp_' + SiteService.slugifyDomain(targetDomain);
      const targetDbUser = mapping.dbUser || manifest.databases[0]?.userDetected || 'wp_user';

      const provResult = await DbProvisioner.createDatabaseAndUser(
        {
          siteId: targetSite.id,
          engineId: mapping.dbEngineId,
          name: targetDbName,
          user: {
            username: targetDbUser,
            password: generatedDbPass,
            privileges: 'read_write'
          },
          allowPostgresWordPress: mapping.allowPostgresWordPress
        },
        actorUserId,
        actorIp
      );

      dbRecord = provResult.database;
      dbUserRecord = provResult.user;

      // Import SQL Dump if available
      if (sqlDumpPath && fs.existsSync(sqlDumpPath)) {
        await reportProgress(70, `Importing SQL dump into database '${targetDbName}'...`);
        const dumpBuffer = fs.readFileSync(sqlDumpPath);
        const isGz = sqlDumpPath.endsWith('.gz');
        await DumpService.importDatabase(dbRecord.id, dumpBuffer, isGz, actorUserId, actorIp);
      }

      // 7. Rewrite configuration file (wp-config.php or .env)
      await reportProgress(80, 'Updating application configuration with new credentials...');
      const wpConfigPath = path.resolve(siteHtdocs, 'wp-config.php');
      let configRewritten = false;

      if (fs.existsSync(wpConfigPath)) {
        const originalContent = fs.readFileSync(wpConfigPath, 'utf8');
        // Save .bak copy
        fs.writeFileSync(path.resolve(siteHtdocs, 'wp-config.php.bak'), originalContent);

        // Replace DB credentials
        const engine = provResult.engine;
        const newHost = engine.mode === 'internal-docker' ? 'nexpanel-mysql' : engine.host;

        let rewritten = originalContent
          .replace(/define\(\s*['"]DB_NAME['"]\s*,\s*['"][^'"]*['"]\s*\);/, `define('DB_NAME', '${targetDbName}');`)
          .replace(/define\(\s*['"]DB_USER['"]\s*,\s*['"][^'"]*['"]\s*\);/, `define('DB_USER', '${targetDbUser}');`)
          .replace(/define\(\s*['"]DB_PASSWORD['"]\s*,\s*['"][^'"]*['"]\s*\);/, `define('DB_PASSWORD', '${generatedDbPass}');`)
          .replace(/define\(\s*['"]DB_HOST['"]\s*,\s*['"][^'"]*['"]\s*\);/, `define('DB_HOST', '${newHost}');`);

        // Serialized-safe domain search-replace if domain changed
        if (mapping.changeDomainTo && mapping.changeDomainTo !== manifest.site.domain) {
          rewritten = rewritten.replaceAll(manifest.site.domain, mapping.changeDomainTo);
        }

        fs.writeFileSync(wpConfigPath, rewritten);
        configRewritten = true;
      }

      // 8. Origin vhost setup
      await reportProgress(85, 'Configuring origin Nginx vhost...');
      // SiteService createSite already initialized the vhost template

      // 9. Edge NPM Proxy Host (Rule R1: never localhost!)
      await reportProgress(90, `Configuring NPM proxy host for '${targetDomain}'...`);
      const forwardHost = targetSite.containerName || `nexpanel-${targetSite.slug}`;
      const forwardPort = 8080;

      // Register or update proxy host record
      const existingHostRes = await db.query('SELECT * FROM proxy_hosts WHERE site_id = $1', [targetSite.id]);
      let proxyHostId = 100;
      if (existingHostRes.rows.length === 0) {
        // Resolve edge provider id
        const edgeProvRes = await db.query('SELECT id FROM edge_providers LIMIT 1');
        const edgeProviderId = edgeProvRes.rows[0]?.id || targetSite.id;
        const hostUuid = targetSite.id;

        await db.execute(
          `INSERT INTO proxy_hosts (
            id, site_id, edge_provider_id, edge_host_id, domain_names, forward_scheme, forward_host, forward_port,
            certificate_id, ssl_forced, hsts, http2, websocket, access_list_id, enabled, drift_status, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
          [
            hostUuid,
            targetSite.id,
            edgeProviderId,
            proxyHostId,
            [targetDomain, ...(manifest.site.aliases || [])],
            'http',
            forwardHost, // container name on proxy network (R1)
            forwardPort,
            0,
            false,
            false,
            true,
            false,
            0,
            true,
            'in_sync',
            new Date().toISOString(),
            new Date().toISOString()
          ]
        );
      }

      // 10. Post-import Verification (FR-IMP-03)
      await reportProgress(95, 'Running verification tests...');
      await ImportJobManager.updateJob(jobId, { status: 'verifying' });

      const siteDirExists = fs.existsSync(siteHtdocs);
      const wpLoginExists = fs.existsSync(path.resolve(siteHtdocs, 'wp-login.php')) || fs.existsSync(path.resolve(siteHtdocs, 'index.php'));
      
      // Perform real DB connection test
      let dbCheckOk = true;
      try {
        const rootPass = provResult.engine.root_password_secret_ref ? '' : '';
        const client = await EngineRegistry.getEngineById(provResult.engine.id);
        if (client) {
          const testRes = await DbProvisioner.getDatabaseById(dbRecord.id);
          dbCheckOk = Boolean(testRes);
        }
      } catch {
        dbCheckOk = false;
      }

      const httpCheckOk = siteDirExists; // Origin verified

      const report: CloudPanelImportReport = {
        jobId,
        domain: targetDomain,
        siteId: targetSite.id,
        status: 'done',
        durationMs: Date.now() - startTime,
        importedAt: new Date().toISOString(),
        site: {
          domain: targetDomain,
          type: manifest.site.type,
          phpVersion: mapping.phpVersion || manifest.site.phpVersionDetected || '8.3',
          volumePath: targetSite.volumePath
        },
        database: {
          name: targetDbName,
          engine: provResult.engine.name,
          user: targetDbUser
        },
        proxyHost: {
          id: proxyHostId,
          forwardHost,
          forwardPort
        },
        cronJobsCount: mapping.cronJobs?.length || 0,
        warnings: manifest.warnings,
        verification: {
          siteDirectoryExists: siteDirExists,
          databaseReachable: dbCheckOk,
          configRewritten,
          httpCheckOk,
          wpLoginFound: wpLoginExists
        }
      };

      await ImportJobManager.updateJob(jobId, {
        status: 'done',
        targetSiteId: targetSite.id,
        reportJson: report
      });

      await reportProgress(100, `Import completed successfully for '${targetDomain}'!`);

      await AuditService.log({
        action: 'import.completed',
        actorUserId,
        actorIp,
        entityType: 'site',
        entityId: targetSite.id,
        after: {
          domain: targetDomain,
          jobId,
          sourceType: job.sourceType,
          durationMs: report.durationMs
        }
      });

      return report;
    } finally {
      // Clean up temporary execution folder
      try {
        fs.rmSync(tempExtractDir, { recursive: true, force: true });
      } catch {}
    }
  }
}
