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
  errors?: string[];
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
    const errors: string[] = [];

    if (job.preImportSnapshotId && job.targetSiteId) {
      // 1. Overwrite scenario: restore pre-import safety snapshot
      try {
        await RestoreService.restoreSite(
          {
            siteId: job.targetSiteId,
            snapshotPathOrId: job.preImportSnapshotId,
            preRestoreBackup: false
          },
          actorUserId,
          actorIp
        );
      } catch (err: any) {
        errors.push(`Failed to restore pre-import snapshot: ${err.message || String(err)}`);
      }
    } else if (job.targetSiteId) {
      // 2. Freshly created site scenario: clean up DBs, proxy hosts, and site files
      try {
        const dbsRes = await db.query('SELECT id FROM databases WHERE site_id = $1', [job.targetSiteId]);
        for (const row of dbsRes.rows) {
          try {
            await DbProvisioner.deleteDatabase(row.id, actorUserId, actorIp);
          } catch (err: any) {
            errors.push(`Failed to delete database ${row.id}: ${err.message || String(err)}`);
          }
        }
        await db.execute('DELETE FROM db_users WHERE database_id IN (SELECT id FROM databases WHERE site_id = $1)', [job.targetSiteId]);
        await db.execute('DELETE FROM databases WHERE site_id = $1', [job.targetSiteId]);
      } catch (err: any) {
        errors.push(`Failed to clean up database records: ${err.message || String(err)}`);
      }

      try {
        // Also remove from edge provider if edge_host_id exists
        const proxyRes = await db.query('SELECT edge_host_id FROM proxy_hosts WHERE site_id = $1', [job.targetSiteId]);
        for (const prow of proxyRes.rows) {
          if (prow.edge_host_id) {
            try {
              const { NpmEdgeProvider } = await import('../edge/npm-provider.js');
              const provider = await NpmEdgeProvider.getDefault();
              await provider.deleteHost(Number(prow.edge_host_id));
            } catch (err: any) {
              // Non-fatal if NPM is offline or host was already removed
            }
          }
        }
        await db.execute('DELETE FROM proxy_hosts WHERE site_id = $1', [job.targetSiteId]);
      } catch (err: any) {
        errors.push(`Failed to remove proxy host: ${err.message || String(err)}`);
      }

      try {
        await SiteService.purgeSite(job.targetSiteId, actorUserId, actorIp);
      } catch (err: any) {
        errors.push(`Failed to purge site ${job.targetSiteId}: ${err.message || String(err)}`);
      }
    }

    const success = errors.length === 0;

    // Update job status to rolled_back or failed
    await ImportJobManager.updateJob(jobId, {
      status: success ? 'rolled_back' : 'failed'
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
        hadSnapshot: Boolean(job.preImportSnapshotId),
        success,
        errors: errors.length > 0 ? errors : undefined
      }
    });

    return {
      success,
      message: success
        ? 'CloudPanel import rolled back successfully; target restored to pre-import state.'
        : `Rollback encountered errors: ${errors.join('; ')}`,
      jobId,
      errors: errors.length > 0 ? errors : undefined
    };
  }
}
