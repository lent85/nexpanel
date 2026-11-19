import { v7 as uuidv7 } from 'uuid';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDb } from '../db/index.js';
import { Job, JobStatus } from '../db/types.js';
import { getEnv } from '../config/env.js';

export type JobHandler<T = any> = (job: Job, updateProgress: (pct: number, msg?: string) => Promise<void>, log: (msg: string) => void) => Promise<T>;

export class JobService {
  private static handlers: Map<string, JobHandler> = new Map();
  private static activeWorkers: Map<string, boolean> = new Map();

  public static registerHandler<T = any>(type: string, handler: JobHandler<T>): void {
    JobService.handlers.set(type, handler);
  }

  public static getLogPath(jobId: string): string {
    const env = getEnv();
    const jobsDir = path.resolve(env.PANEL_DATA_DIR, 'jobs');
    if (!fs.existsSync(jobsDir)) {
      fs.mkdirSync(jobsDir, { recursive: true });
    }
    return path.resolve(jobsDir, `${jobId}.log`);
  }

  public static async enqueue(params: {
    type: string;
    payload: Record<string, unknown>;
    idempotencyKey?: string;
    siteId?: string;
    createdByUserId?: string;
    maxAttempts?: number;
  }): Promise<Job> {
    const db = getDb();

    // Check idempotency
    if (params.idempotencyKey) {
      const existing = await db.query<Job>(
        'SELECT * FROM jobs WHERE idempotency_key = $1',
        [params.idempotencyKey]
      );
      if (existing.rows.length > 0) {
        return existing.rows[0];
      }
    }

    const id = uuidv7();
    const now = new Date().toISOString();
    const logPath = JobService.getLogPath(id);

    const job: Job = {
      id,
      type: params.type,
      payloadJson: params.payload,
      idempotencyKey: params.idempotencyKey,
      status: 'queued',
      progressPct: 0,
      logPath,
      attempts: 0,
      maxAttempts: params.maxAttempts || 3,
      createdByUserId: params.createdByUserId,
      siteId: params.siteId,
      createdAt: now,
      updatedAt: now
    };

    await db.execute(
      `INSERT INTO jobs (id, type, payload_json, idempotency_key, status, progress_pct, log_path, attempts, max_attempts, created_by_user_id, site_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        job.id,
        job.type,
        JSON.stringify(job.payloadJson),
        job.idempotencyKey || null,
        job.status,
        job.progressPct,
        job.logPath,
        job.attempts,
        job.maxAttempts,
        job.createdByUserId || null,
        job.siteId || null,
        job.createdAt,
        job.updatedAt
      ]
    );

    // Trigger asynchronous execution
    setImmediate(() => {
      JobService.executeJob(job.id).catch((err) => {
        console.error(`Error executing job ${job.id}:`, err);
      });
    });

    return job;
  }

  public static async get(id: string): Promise<Job | null> {
    const db = getDb();
    const res = await db.query<Job>('SELECT * FROM jobs WHERE id = $1', [id]);
    if (res.rows.length === 0) return null;
    const r: any = res.rows[0];
    return {
      id: r.id,
      type: r.type,
      payloadJson: typeof r.payload_json === 'string' ? JSON.parse(r.payload_json) : (r.payload_json || r.payloadJson),
      idempotencyKey: r.idempotency_key || r.idempotencyKey,
      status: r.status,
      progressPct: r.progress_pct ?? r.progressPct ?? 0,
      logPath: r.log_path || r.logPath,
      attempts: r.attempts ?? 0,
      maxAttempts: r.max_attempts ?? r.maxAttempts ?? 3,
      createdByUserId: r.created_by_user_id || r.createdByUserId,
      siteId: r.site_id || r.siteId,
      errorMessage: r.error_message || r.errorMessage,
      createdAt: r.created_at || r.createdAt,
      updatedAt: r.updated_at || r.updatedAt,
      startedAt: r.started_at || r.startedAt,
      completedAt: r.completed_at || r.completedAt
    };
  }

  public static getLogs(job: Job): string {
    if (job.logPath && fs.existsSync(job.logPath)) {
      return fs.readFileSync(job.logPath, 'utf8');
    }
    return '';
  }

  public static async executeJob(jobId: string): Promise<void> {
    const job = await JobService.get(jobId);
    if (!job || job.status !== 'queued') return;

    const handler = JobService.handlers.get(job.type);
    if (!handler) {
      await JobService.markFailed(jobId, `No handler registered for job type: ${job.type}`);
      return;
    }

    const db = getDb();
    const startedAt = new Date().toISOString();
    await db.execute(
      `UPDATE jobs SET status = 'running', started_at = $1, attempts = attempts + 1, updated_at = $2 WHERE id = $3`,
      [startedAt, startedAt, jobId]
    );

    const logStream = fs.createWriteStream(job.logPath!, { flags: 'a' });
    const log = (msg: string) => {
      const ts = new Date().toISOString();
      logStream.write(`[${ts}] ${msg}\n`);
    };

    const updateProgress = async (pct: number, msg?: string) => {
      const now = new Date().toISOString();
      await db.execute(
        `UPDATE jobs SET progress_pct = $1, updated_at = $2 WHERE id = $3`,
        [pct, now, jobId]
      );
      if (msg) log(`Progress ${pct}%: ${msg}`);
    };

    try {
      log(`Starting execution of job ${job.id} (${job.type})`);
      await handler(job, updateProgress, log);
      const completedAt = new Date().toISOString();
      await db.execute(
        `UPDATE jobs SET status = 'done', progress_pct = 100, completed_at = $1, updated_at = $2 WHERE id = $3`,
        [completedAt, completedAt, jobId]
      );
      log(`Job ${job.id} completed successfully`);
    } catch (err: any) {
      log(`Job failed with error: ${err.message || String(err)}`);
      await JobService.markFailed(jobId, err.message || String(err));
    } finally {
      logStream.end();
    }
  }

  private static async markFailed(jobId: string, error: string): Promise<void> {
    const db = getDb();
    const now = new Date().toISOString();
    await db.execute(
      `UPDATE jobs SET status = 'failed', error_message = $1, completed_at = $2, updated_at = $3 WHERE id = $4`,
      [error, now, now, jobId]
    );
  }
}
