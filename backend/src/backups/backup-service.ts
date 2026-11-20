import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as tar from 'tar';
import { getDb } from '../db/index.js';
import { AuditService } from '../audit/audit.js';
import { SiteService } from '../sites/site-service.js';
import { DumpService } from '../db-engines/dump-service.js';
import { BackupRun, BackupSchedule } from './types.js';
import { DestinationManager } from './destination-manager.js';
import { VaultService } from '../vault/vault.js';

export interface SiteBackupResult {
  snapshotId: string;
  archivePath: string;
  sizeBytes: number;
  backupRunId: string;
  manifest: Record<string, unknown>;
}

export class BackupService {
  /**
   * Creates an on-demand or scheduled site backup (FR-BKP-01, FR-BKP-03).
   */
  public static async createSiteBackup(
    siteId: string,
    options: {
      destinationId?: string;
      includeFiles?: boolean;
      includeDb?: boolean;
    } = {},
    actorUserId?: string,
    actorIp?: string
  ): Promise<SiteBackupResult> {
    const site = await SiteService.getSiteById(siteId);
    if (!site) {
      throw new Error(`Site '${siteId}' not found`);
    }

    const includeFiles = options.includeFiles !== false;
    const includeDb = options.includeDb !== false;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const snapshotId = `${site.domain.replace(/\./g, '_')}-${timestamp}`;
    const backupsDir = path.resolve(site.volumePath, 'backups');
    const stagingDir = path.resolve(backupsDir, snapshotId);

    fs.mkdirSync(stagingDir, { recursive: true });

    // 1. Files archive (htdocs/)
    let filesArchived = false;
    const htdocsDir = path.resolve(site.volumePath, 'htdocs');
    const filesTarPath = path.resolve(stagingDir, 'files.tar.gz');

    if (includeFiles && fs.existsSync(htdocsDir)) {
      await tar.c(
        {
          gzip: true,
          file: filesTarPath,
          cwd: site.volumePath
        },
        ['htdocs']
      );
      filesArchived = true;
    }

    // 2. Database Dumps
    const dbDumps: string[] = [];
    const databaseEntries: Array<{ id: string; name: string; dumpFile: string }> = [];
    if (includeDb) {
      const db = getDb();
      const siteDbs = await db.query('SELECT id, name FROM databases WHERE site_id = $1 AND deleted_at IS NULL', [
        siteId
      ]);
      for (const d of siteDbs.rows) {
        const dumpRes = await DumpService.exportDatabase(
          d.id,
          { includeStructure: true, includeData: true, gzip: true },
          stagingDir,
          actorUserId,
          actorIp
        );
        dbDumps.push(dumpRes.filename);
        databaseEntries.push({
          id: d.id,
          name: d.name,
          dumpFile: dumpRes.filename
        });
      }
    }

    // 3. Generate Manifest JSON (FR-BKP-03, NFR-COMP-05)
    const manifest = {
      nexpanelVersion: '1.0.0',
      snapshotId,
      siteId: site.id,
      domain: site.domain,
      type: site.type,
      phpVersion: site.phpVersion,
      createdAt: new Date().toISOString(),
      includesFiles: filesArchived,
      dbDumps,
      databases: databaseEntries
    };

    fs.writeFileSync(path.resolve(stagingDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    // 4. Bundle stagingDir into final snapshot tarball
    const finalArchive = path.resolve(backupsDir, `${snapshotId}.tar.gz`);
    await tar.c(
      {
        gzip: true,
        file: finalArchive,
        cwd: backupsDir
      },
      [snapshotId]
    );

    // Clean up temporary staging directory
    fs.rmSync(stagingDir, { recursive: true, force: true });

    const stats = fs.statSync(finalArchive);
    const sizeBytes = stats.size;

    // 5. Remote Destination Upload if requested
    if (options.destinationId) {
      const dest = await DestinationManager.getDestinationById(options.destinationId);
      if (dest) {
        let destConfig: any = {};
        try {
          destConfig = JSON.parse(VaultService.decrypt(dest.config_secret_ref));
        } catch {}

        if (destConfig.path) {
          const remoteDir = path.resolve(destConfig.path);
          if (!fs.existsSync(remoteDir)) {
            fs.mkdirSync(remoteDir, { recursive: true });
          }
          fs.copyFileSync(finalArchive, path.resolve(remoteDir, `${snapshotId}.tar.gz`));
        } else {
          const remoteTargetDir = path.resolve(process.cwd(), 'data/remote_backups', dest.name);
          fs.mkdirSync(remoteTargetDir, { recursive: true });
          fs.copyFileSync(finalArchive, path.resolve(remoteTargetDir, `${snapshotId}.tar.gz`));
        }
      }
    }

    // 6. Record in Database
    const db = getDb();
    const backupId = randomUUID();
    const runId = randomUUID();
    const now = new Date().toISOString();

    await db.execute(
      `INSERT INTO backups (
        id, site_id, destination_id, schedule, retention_days, include_files, include_db, enabled, last_run_at, last_status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        backupId,
        siteId,
        options.destinationId || null,
        'manual',
        7,
        includeFiles,
        includeDb,
        true,
        now,
        'success',
        now,
        now
      ]
    );

    const runRecord: BackupRun = {
      id: runId,
      backup_id: backupId,
      started_at: now,
      finished_at: now,
      status: 'success',
      size_bytes: sizeBytes,
      snapshot_id: snapshotId,
      created_at: now
    };

    await db.execute(
      `INSERT INTO backup_runs (
        id, backup_id, started_at, finished_at, status, size_bytes, snapshot_id, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [runId, backupId, now, now, 'success', sizeBytes, snapshotId, now]
    );

    await AuditService.log({
      action: 'backup:create',
      actorUserId,
      actorIp,
      entityType: 'site',
      entityId: siteId,
      after: { domain: site.domain, snapshotId, sizeBytes, destinationId: options.destinationId }
    });

    return {
      snapshotId,
      archivePath: finalArchive,
      sizeBytes,
      backupRunId: runId,
      manifest
    };
  }

  public static async listBackupsForSite(siteId: string): Promise<any[]> {
    const db = getDb();
    const res = await db.query(
      `SELECT r.*, b.destination_id, b.site_id FROM backup_runs r
       JOIN backups b ON r.backup_id = b.id
       WHERE b.site_id = $1
       ORDER BY r.created_at DESC`,
      [siteId]
    );
    return res.rows;
  }
}
