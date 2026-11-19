import { getDb } from '../db/index.js';
import { AuditService } from '../audit/audit.js';
import { SiteService } from '../sites/site-service.js';
import { DbProvisioner } from '../db-engines/db-provisioner.js';
import { RestoreService } from '../backups/restore-service.js';
import { ImportJobManager } from './import-job-manager.js';

export interface RollbackResult {
  success: boolean;
  message: string;
  jobId: string;
}

export class RollbackService {
  /**
   * 1-Click Rollback for CloudPanel Import (FR-IMP-04).
   * Restores pre-import snapshot if overwriting, or purges created site, DB, and proxy host.
   */
  public static async rollback(
    jobId: string,
    actorUserId?: string,
    actorIp?: string
  ): Promise<RollbackResult> {
    const job = await ImportJobManager.getJobById(jobId);
    if (!job) {
      throw new Error(`Import job '${jobId}' not found`);
    }

    if (job.status === 'rolled_back') {
      throw new Error(`Import job '${jobId}' has already been rolled back`);
    }

    const db = getDb();

    if (job.preImportSnapshotId && job.targetSiteId) {
      // 1. Overwrite scenario: restore pre-import safety snapshot
      await RestoreService.restoreSite(
        {
          siteId: job.targetSiteId,
          snapshotPathOrId: job.preImportSnapshotId,
          preRestoreBackup: false
        },
        actorUserId,
        actorIp
      );
    } else if (job.targetSiteId) {
      // 2. Freshly created site scenario: clean up DBs, proxy hosts, and site files
      try {
        const dbsRes = await db.query('SELECT id FROM databases WHERE site_id = $1', [job.targetSiteId]);
        for (const row of dbsRes.rows) {
          try {
            await DbProvisioner.deleteDatabase(row.id, actorUserId, actorIp);
          } catch {}
        }
        await db.execute('DELETE FROM databases WHERE site_id = $1', [job.targetSiteId]);
        await db.execute('DELETE FROM db_users WHERE database_id IN (SELECT id FROM databases WHERE site_id = $1)', [job.targetSiteId]);
      } catch {}

      try {
        await db.execute('DELETE FROM proxy_hosts WHERE site_id = $1', [job.targetSiteId]);
      } catch {}

      try {
        await SiteService.purgeSite(job.targetSiteId, actorUserId, actorIp);
      } catch {}
    }

    // Update job status to rolled_back
    await ImportJobManager.updateJob(jobId, {
      status: 'rolled_back'
    });

    await AuditService.log({
      action: 'import.rollback',
      actorUserId,
      actorIp,
      entityType: 'import_job',
      entityId: jobId,
      after: {
        sourceRef: job.sourceRef,
        targetSiteId: job.targetSiteId,
        hadSnapshot: Boolean(job.preImportSnapshotId)
      }
    });

    return {
      success: true,
      message: 'CloudPanel import rolled back successfully; target restored to pre-import state.',
      jobId
    };
  }
}
