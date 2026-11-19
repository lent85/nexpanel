import * as fs from 'node:fs';
import * as path from 'node:path';
import * as tar from 'tar';
import { getDb } from '../db/index.js';
import { AuditService } from '../audit/audit.js';
import { SiteService } from '../sites/site-service.js';
import { DumpService } from '../db-engines/dump-service.js';
import { BackupService } from './backup-service.js';
import { RestoreOptions, RestoreResult } from './types.js';

export class RestoreService {
  /**
   * 1-Click Site Restore (FR-BKP-02).
   * Automatically takes a pre-restore safety snapshot before modifying files or DB!
   */
  public static async restoreSite(
    options: RestoreOptions,
    actorUserId?: string,
    actorIp?: string
  ): Promise<RestoreResult> {
    const site = await SiteService.getSiteById(options.siteId);
    if (!site) {
      throw new Error(`Target site '${options.siteId}' not found`);
    }

    // 1. Locate Snapshot Archive
    let archivePath = options.snapshotPathOrId;
    if (!fs.existsSync(archivePath)) {
      const candidate = path.resolve(site.volumePath, 'backups', `${options.snapshotPathOrId}.tar.gz`);
      if (fs.existsSync(candidate)) {
        archivePath = candidate;
      } else {
        throw new Error(`Backup snapshot archive not found at '${options.snapshotPathOrId}'`);
      }
    }

    // 2. Pre-Restore Safety Snapshot (BETTER)
    let preRestoreSnapshotId: string | undefined;
    if (options.preRestoreBackup !== false) {
      const preBackup = await BackupService.createSiteBackup(
        site.id,
        { includeFiles: true, includeDb: true },
        actorUserId,
        actorIp
      );
      preRestoreSnapshotId = preBackup.snapshotId;
    }

    // 3. Extract Snapshot to Temp Workspace
    const tempRestoreDir = path.resolve(site.volumePath, 'backups', `restore_tmp_${Date.now()}`);
    fs.mkdirSync(tempRestoreDir, { recursive: true });

    await tar.x({
      file: archivePath,
      cwd: tempRestoreDir
    });

    // Handle nested folder if archived with top-level snapshot name
    const entries = fs.readdirSync(tempRestoreDir);
    let workingDir = tempRestoreDir;
    if (entries.length === 1 && fs.statSync(path.resolve(tempRestoreDir, entries[0])).isDirectory()) {
      workingDir = path.resolve(tempRestoreDir, entries[0]);
    }

    // Read manifest
    const manifestPath = path.resolve(workingDir, 'manifest.json');
    let manifest: any = {};
    if (fs.existsSync(manifestPath)) {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    }

    // 4. Restore Files (htdocs/)
    let filesRestored = false;
    const filesTarPath = path.resolve(workingDir, 'files.tar.gz');
    if (options.restoreFiles !== false && fs.existsSync(filesTarPath)) {
      const htdocsDir = path.resolve(site.volumePath, 'htdocs');
      fs.mkdirSync(htdocsDir, { recursive: true });

      await tar.x({
        file: filesTarPath,
        cwd: site.volumePath
      });
      filesRestored = true;
    }

    // 5. Restore Database
    let dbRestored = false;
    if (options.restoreDb !== false) {
      const db = getDb();
      const siteDbs = await db.query('SELECT id, name FROM databases WHERE site_id = $1 AND deleted_at IS NULL', [
        site.id
      ]);

      if (siteDbs.rows.length > 0) {
        const targetDbId = siteDbs.rows[0].id;
        const dumpFiles = fs.readdirSync(workingDir).filter((f) => f.endsWith('.sql.gz') || f.endsWith('.sql'));

        for (const df of dumpFiles) {
          const dumpFilePath = path.resolve(workingDir, df);
          const content = fs.readFileSync(dumpFilePath);
          const isGzip = df.endsWith('.gz');

          await DumpService.importDatabase(targetDbId, content, isGzip, actorUserId, actorIp);
          dbRestored = true;
        }
      }
    }

    // Clean up temporary workspace
    fs.rmSync(tempRestoreDir, { recursive: true, force: true });

    await AuditService.log({
      action: 'backup:restore',
      actorUserId,
      actorIp,
      entityType: 'site',
      entityId: site.id,
      after: {
        domain: site.domain,
        archivePath,
        filesRestored,
        dbRestored,
        preRestoreSnapshotId
      }
    });

    return {
      success: true,
      siteDomain: site.domain,
      filesRestored,
      dbRestored,
      preRestoreSnapshotId,
      message: `Site '${site.domain}' restored successfully${
        preRestoreSnapshotId ? ` (safety pre-restore snapshot: ${preRestoreSnapshotId})` : ''
      }`
    };
  }
}
