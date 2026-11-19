import { v7 as uuidv7 } from 'uuid';
import { getDb } from '../db/index.js';
import {
  CloudPanelImportJobRecord,
  CloudPanelSourceType,
  CloudPanelManifest,
  CloudPanelMapping,
  CloudPanelDryRunResult,
  ImportJobStatus,
  CloudPanelImportReport
} from './types.js';

export interface CreateImportJobInput {
  sourceType: CloudPanelSourceType;
  sourceRef: string;
  createdByUserId?: string;
}

export class ImportJobManager {
  public static async createJob(input: CreateImportJobInput): Promise<CloudPanelImportJobRecord> {
    const db = getDb();
    const id = uuidv7();
    const now = new Date().toISOString();

    const record: CloudPanelImportJobRecord = {
      id,
      sourceType: input.sourceType,
      sourceRef: input.sourceRef,
      manifestJson: null,
      mappingJson: null,
      dryRunResultJson: null,
      status: 'uploaded',
      targetSiteId: null,
      logPath: `data/jobs/import-${id}.log`,
      createdByUserId: input.createdByUserId || null,
      createdAt: now,
      updatedAt: now
    };

    await db.execute(
      `INSERT INTO import_jobs (
        id, source_type, source_ref, manifest_json, mapping_json, dry_run_result_json,
        status, target_site_id, log_path, created_by_user_id, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        record.id,
        record.sourceType,
        record.sourceRef,
        record.manifestJson ? JSON.stringify(record.manifestJson) : null,
        record.mappingJson ? JSON.stringify(record.mappingJson) : null,
        record.dryRunResultJson ? JSON.stringify(record.dryRunResultJson) : null,
        record.status,
        record.targetSiteId,
        record.logPath,
        record.createdByUserId,
        record.createdAt,
        record.updatedAt
      ]
    );

    return record;
  }

  public static async getJobById(id: string): Promise<CloudPanelImportJobRecord | null> {
    const db = getDb();
    const res = await db.query('SELECT * FROM import_jobs WHERE id = $1', [id]);
    if (res.rows.length === 0) return null;

    const row = res.rows[0];
    return ImportJobManager.mapRow(row);
  }

  public static async updateJob(
    id: string,
    updates: Partial<{
      manifestJson: CloudPanelManifest;
      mappingJson: CloudPanelMapping;
      dryRunResultJson: CloudPanelDryRunResult;
      status: ImportJobStatus;
      targetSiteId: string | null;
      preImportSnapshotId: string | null;
      reportJson: CloudPanelImportReport | null;
      logPath: string;
    }>
  ): Promise<CloudPanelImportJobRecord> {
    const db = getDb();
    const existing = await ImportJobManager.getJobById(id);
    if (!existing) {
      throw new Error(`Import job '${id}' not found`);
    }

    const setClauses: string[] = ['updated_at = $1'];
    const params: any[] = [new Date().toISOString()];
    let idx = 2;

    if (updates.manifestJson !== undefined) {
      setClauses.push(`manifest_json = $${idx++}`);
      params.push(updates.manifestJson ? JSON.stringify(updates.manifestJson) : null);
    }
    if (updates.mappingJson !== undefined) {
      setClauses.push(`mapping_json = $${idx++}`);
      params.push(updates.mappingJson ? JSON.stringify(updates.mappingJson) : null);
    }
    if (updates.dryRunResultJson !== undefined) {
      setClauses.push(`dry_run_result_json = $${idx++}`);
      params.push(updates.dryRunResultJson ? JSON.stringify(updates.dryRunResultJson) : null);
    }
    if (updates.status !== undefined) {
      setClauses.push(`status = $${idx++}`);
      params.push(updates.status);
    }
    if (updates.targetSiteId !== undefined) {
      setClauses.push(`target_site_id = $${idx++}`);
      params.push(updates.targetSiteId);
    }
    if (updates.preImportSnapshotId !== undefined) {
      setClauses.push(`pre_import_snapshot_id = $${idx++}`);
      params.push(updates.preImportSnapshotId);
    }
    if (updates.reportJson !== undefined) {
      setClauses.push(`report_json = $${idx++}`);
      params.push(updates.reportJson ? JSON.stringify(updates.reportJson) : null);
    }
    if (updates.logPath !== undefined) {
      setClauses.push(`log_path = $${idx++}`);
      params.push(updates.logPath);
    }

    params.push(id);
    await db.execute(`UPDATE import_jobs SET ${setClauses.join(', ')} WHERE id = $${idx}`, params);

    return (await ImportJobManager.getJobById(id))!;
  }

  public static async listJobs(): Promise<CloudPanelImportJobRecord[]> {
    const db = getDb();
    const res = await db.query('SELECT * FROM import_jobs ORDER BY created_at DESC');
    return res.rows.map(ImportJobManager.mapRow);
  }

  /**
   * Idempotency Check (FR-IMP-04): Finds if an import job with the given SHA-256 and target domain
   * has already succeeded.
   */
  public static async findCompletedByChecksumAndDomain(
    sha256: string,
    domain: string
  ): Promise<CloudPanelImportJobRecord | null> {
    const all = await ImportJobManager.listJobs();
    for (const job of all) {
      if (job.status === 'done' && job.manifestJson?.source?.sha256 === sha256) {
        const jobDomain = job.mappingJson?.changeDomainTo || job.mappingJson?.domain || job.manifestJson?.site?.domain;
        if (jobDomain?.toLowerCase() === domain.toLowerCase()) {
          return job;
        }
      }
    }
    return null;
  }

  private static mapRow(row: any): CloudPanelImportJobRecord {
    return {
      id: row.id,
      sourceType: row.source_type,
      sourceRef: row.source_ref,
      manifestJson: typeof row.manifest_json === 'string' ? JSON.parse(row.manifest_json) : row.manifest_json,
      mappingJson: typeof row.mapping_json === 'string' ? JSON.parse(row.mapping_json) : row.mapping_json,
      dryRunResultJson:
        typeof row.dry_run_result_json === 'string' ? JSON.parse(row.dry_run_result_json) : row.dry_run_result_json,
      status: row.status,
      targetSiteId: row.target_site_id,
      preImportSnapshotId: row.pre_import_snapshot_id,
      reportJson: typeof row.report_json === 'string' ? JSON.parse(row.report_json) : row.report_json,
      logPath: row.log_path,
      createdByUserId: row.created_by_user_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
