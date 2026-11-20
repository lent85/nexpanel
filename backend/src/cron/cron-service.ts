import { v7 as uuidv7 } from 'uuid';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { getDb } from '../db/index.js';
import { CronJob, CronRun } from '../db/types.js';

const execAsync = promisify(exec);

export class CronService {
  /**
   * Validates standard 5-field cron expression:
   * minute hour day-of-month month day-of-week
   */
  public static validateSchedule(schedule: string): boolean {
    const parts = schedule.trim().split(/\s+/);
    if (parts.length !== 5) return false;

    const cronRegex = /^[\*0-9,\-\/]+$/;
    return parts.every((p) => cronRegex.test(p));
  }

  public static calculateNextRun(schedule: string, fromDate = new Date()): Date {
    // Rough next-run estimate for preview
    const next = new Date(fromDate.getTime() + 60 * 1000); // at least +1 min
    next.setSeconds(0, 0);
    return next;
  }

  public static async createCronJob(params: {
    siteId: string;
    name: string;
    schedule: string;
    command: string;
    timeoutSec?: number;
    notifyOnFailure?: boolean;
  }): Promise<CronJob> {
    if (!CronService.validateSchedule(params.schedule)) {
      const err = new Error(`Invalid cron expression: "${params.schedule}". Expected standard 5-field syntax (e.g. "*/15 * * * *").`);
      (err as any).statusCode = 400;
      throw err;
    }

    const db = getDb();
    const id = uuidv7();
    const now = new Date().toISOString();
    const nextRun = CronService.calculateNextRun(params.schedule).toISOString();

    const job: CronJob = {
      id,
      siteId: params.siteId,
      name: params.name,
      schedule: params.schedule,
      command: params.command,
      enabled: true,
      timeoutSec: params.timeoutSec || 3600,
      notifyOnFailure: params.notifyOnFailure !== false,
      nextRunAt: nextRun,
      createdAt: now,
      updatedAt: now
    };

    await db.execute(
      `INSERT INTO cron_jobs (id, site_id, name, schedule, command, enabled, timeout_sec, notify_on_failure, next_run_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        job.id,
        job.siteId,
        job.name,
        job.schedule,
        job.command,
        job.enabled,
        job.timeoutSec,
        job.notifyOnFailure,
        job.nextRunAt,
        job.createdAt,
        job.updatedAt
      ]
    );

    return job;
  }

  public static async executeJob(jobId: string): Promise<CronRun> {
    const db = getDb();
    const res = await db.query<CronJob>('SELECT * FROM cron_jobs WHERE id = $1', [jobId]);
    if (res.rows.length === 0) {
      const err = new Error('Cron job not found');
      (err as any).statusCode = 404;
      throw err;
    }

    const job = res.rows[0];
    const runId = uuidv7();
    const startedAt = new Date();
    let exitCode = 0;
    let stdoutTail = '';
    let stderrTail = '';

    try {
      // Execute command with timeout
      const shell = process.platform === 'win32' ? 'powershell' : '/bin/bash';
      const result = await execAsync(job.command, {
        timeout: (job.timeoutSec || 3600) * 1000,
        shell
      });
      stdoutTail = (result.stdout || '').substring(0, 1000);
      stderrTail = (result.stderr || '').substring(0, 1000);
    } catch (err: any) {
      exitCode = err.code || 1;
      stdoutTail = (err.stdout || '').substring(0, 1000);
      stderrTail = (err.stderr || err.message || '').substring(0, 1000);
    }

    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();
    const nowIso = finishedAt.toISOString();
    const nextRun = CronService.calculateNextRun(job.schedule, finishedAt).toISOString();

    const run: CronRun = {
      id: runId,
      cronJobId: jobId,
      startedAt: startedAt.toISOString(),
      finishedAt: nowIso,
      exitCode,
      stdoutTail,
      stderrTail,
      durationMs
    };

    await db.execute(
      `INSERT INTO cron_runs (id, cron_job_id, started_at, finished_at, exit_code, stdout_tail, stderr_tail, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [run.id, run.cronJobId, run.startedAt, run.finishedAt, run.exitCode, run.stdoutTail, run.stderrTail, run.durationMs]
    );

    await db.execute(
      `UPDATE cron_jobs SET last_run_at = $1, last_exit_code = $2, next_run_at = $3, updated_at = $1 WHERE id = $4`,
      [nowIso, exitCode, nextRun, jobId]
    );

    return run;
  }
}
