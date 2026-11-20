import * as fs from 'node:fs';
import * as path from 'node:path';
import * as tar from 'tar';
import { getDb } from '../db/index.js';
import { AuditService } from '../audit/audit.js';
import { SiteService } from '../sites/site-service.js';
import { DumpService } from '../db-engines/dump-service.js';
import { JobService } from '../jobs/job-service.js';
import { BackupService } from './backup-service.js';
import { RestoreOptions, RestoreResult } from './types.js';

export class RestoreService {
  /**
   * 1-Click Site Restore (FR-BKP-02).
   * Automatically takes a pre-restore safety snapshot before modifying files or DB!
   */
  public static async restoreSite(
    siteIdOrOptions: string | RestoreOptions,
    optionsOrActorUserId?: RestoreOptions | string,
    actorUserId?: string,
    actorIp?: string
  ): Promise<RestoreResult> {
    const options: RestoreOptions =
      typeof siteIdOrOptions === 'string'
        ? { ...(optionsOrActorUserId as RestoreOptions), siteId: siteIdOrOptions }
        : siteIdOrOptions;
    const actor = typeof siteIdOrOptions === 'string' ? actorUserId : (optionsOrActorUserId as string);
    const ip = actorIp;

    const site = await SiteService.getSiteById(options.siteId);
    if (!site) {
      throw new Error(`Target site '${options.siteId}' not found`);
    }

    // 1. Locate Snapshot Archive
    let archivePath = options.snapshotPathOrId || (options as any).archivePath;
    if (!archivePath || !fs.existsSync(archivePath)) {
      const candidate = path.resolve(site.volumePath, 'backups', `${options.snapshotPathOrId || (options as any).archivePath}.tar.gz`);
      if (fs.existsSync(candidate)) {
        archivePath = candidate;
      } else {
        throw new Error(`Backup snapshot archive not found at '${options.snapshotPathOrId || (options as any).archivePath}'`);
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
        const dumpFiles = fs.readdirSync(workingDir).filter((f) => f.endsWith('.sql.gz') || f.endsWith('.sql'));

        // Check if manifest.json exists with explicit database mappings
        let manifestDatabases: Array<{ id?: string; name?: string; dumpFile?: string }> = [];
        const manifestPath = path.resolve(workingDir, 'manifest.json');
        if (fs.existsSync(manifestPath)) {
          try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            if (Array.isArray(manifest.databases)) {
              manifestDatabases = manifest.databases;
            }
          } catch {}
        }

        const restoredDbIds = new Set<string>();

        for (const df of dumpFiles) {
          const dumpFilePath = path.resolve(workingDir, df);
          const content = fs.readFileSync(dumpFilePath);
          const isGzip = df.endsWith('.gz');

          // 1. Try matching via manifest
          const manifestEntry = manifestDatabases.find((m) => m.dumpFile === df);
          let matchedDb = manifestEntry
            ? (siteDbs.rows as any[]).find((r) => r.name === manifestEntry.name || r.id === manifestEntry.id)
            : undefined;

          // 2. If not matched, extract database base name by stripping extension, prefixes and timestamps
          if (!matchedDb) {
            const withoutExt = df.replace(/\.sql(\.gz)?$/, '');
            const withoutPrefix = withoutExt.replace(/^db_/, '');
            // Strip ISO timestamp (e.g. -2026-11-20T22-40-11-000Z or -2026-11-20...)
            const baseName = withoutPrefix
              .replace(/-\d{4}-\d{2}-\d{2}T[\d-]+Z?$/i, '')
              .replace(/-\d{4}-\d{2}-\d{2}.*$/, '');

            // Exact match against baseName, withoutPrefix, or withoutExt
            matchedDb = (siteDbs.rows as any[]).find(
              (r) => r.name === baseName || r.name === withoutPrefix || r.name === withoutExt
            );

            // Prefix match if database name appears at the start followed by separator
            if (!matchedDb) {
              const sortedByLen = [...(siteDbs.rows as any[])].sort((a, b) => b.name.length - a.name.length);
              matchedDb = sortedByLen.find(
                (r) => withoutPrefix.startsWith(`${r.name}-`) || withoutPrefix.startsWith(`${r.name}_`)
              );
            }
          }

          // 3. Fallback only if there is exactly 1 database and 1 dump file
          if (!matchedDb) {
            if (siteDbs.rows.length === 1 && dumpFiles.length === 1) {
              matchedDb = siteDbs.rows[0];
            } else {
              throw new Error(
                `Cannot resolve target database for backup dump '${df}'. Configured databases for site '${site.domain}': [${(siteDbs.rows as any[]).map((r) => r.name).join(', ')}]`
              );
            }
          }

          // 4. Guard against multiple dumps targeting the same database
          if (restoredDbIds.has(matchedDb.id)) {
            throw new Error(
              `Restore conflict: Multiple dump files target database '${matchedDb.name}' (ID: ${matchedDb.id}). Aborting restore to prevent data collision.`
            );
          }

          restoredDbIds.add(matchedDb.id);
          const targetDbId = matchedDb.id;

          const jobId = await DumpService.importDatabase(targetDbId, content, isGzip, actorUserId, actorIp);
          await JobService.waitForJob(jobId, 60000);
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
