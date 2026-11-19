import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../plugins/auth-guard.js';
import { getDb } from '../../db/index.js';
import { CronJob, CronRun } from '../../db/types.js';
import { CronService } from '../../cron/cron-service.js';

const createCronSchema = z.object({
  name: z.string().min(1),
  schedule: z.string().min(9),
  command: z.string().min(1),
  timeoutSec: z.number().int().optional(),
  notifyOnFailure: z.boolean().optional()
});

export async function cronRoutes(fastify: FastifyInstance): Promise<void> {
  // 1. List site cron jobs
  fastify.get('/api/v1/sites/:id/cron', { preHandler: [requirePermission('sites:view')] }, async (request) => {
    const { id } = request.params as { id: string };
    const db = getDb();
    const res = await db.query<CronJob>('SELECT * FROM cron_jobs WHERE site_id = $1 ORDER BY created_at DESC', [id]);
    return { data: res.rows };
  });

  // 2. Create cron job
  fastify.post('/api/v1/sites/:id/cron', { preHandler: [requirePermission('sites:edit')] }, async (request) => {
    const { id } = request.params as { id: string };
    const body = createCronSchema.parse(request.body);
    const job = await CronService.createCronJob({
      siteId: id,
      ...body
    });
    return { job, message: 'Cron job created successfully' };
  });

  // 3. Run cron now (FR-CRON-02)
  fastify.post('/api/v1/cron/:id/run-now', { preHandler: [requirePermission('sites:edit')] }, async (request) => {
    const { id } = request.params as { id: string };
    const run = await CronService.executeJob(id);
    return { run, message: 'Cron job executed' };
  });

  // 4. Get cron run history
  fastify.get('/api/v1/cron/:id/runs', { preHandler: [requirePermission('sites:view')] }, async (request) => {
    const { id } = request.params as { id: string };
    const db = getDb();
    const res = await db.query<CronRun>('SELECT * FROM cron_runs WHERE cron_job_id = $1 ORDER BY started_at DESC LIMIT 50', [id]);
    return { data: res.rows };
  });
}
