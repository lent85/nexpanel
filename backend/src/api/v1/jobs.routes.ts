import { FastifyInstance } from 'fastify';
import { authenticate } from '../plugins/auth-guard.js';
import { JobService } from '../../jobs/job-service.js';
import { getDb } from '../../db/index.js';

export async function jobsRoutes(fastify: FastifyInstance): Promise<void> {
  const checkJobAccess = async (request: any, reply: any, job: any): Promise<boolean> => {
    const user = request.user;
    if (!user) {
      reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return false;
    }

    // Admins and Site Managers can inspect any job
    if (user.role === 'admin' || user.role === 'site_manager') {
      return true;
    }

    // Scoped users / clients: check job site_id, metadata.siteId, or job ownership
    let jobSiteId = (job as any).site_id || job.metadata?.siteId;

    if (!jobSiteId) {
      try {
        const db = getDb();
        const res = await db.query('SELECT site_id FROM jobs WHERE id = $1', [job.id]);
        if (res.rows.length > 0 && res.rows[0].site_id) {
          jobSiteId = res.rows[0].site_id;
        }
      } catch {}
    }

    const assignedSites: string[] = user.assignedSiteIds || [];

    if (jobSiteId) {
      if (!assignedSites.includes(jobSiteId)) {
        reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Access denied to this job' } });
        return false;
      }
      return true;
    }

    const jobUserId = (job as any).user_id || (job as any).createdByUserId || job.metadata?.userId;
    if (jobUserId && jobUserId === user.id) {
      return true;
    }

    reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Access denied to this job' } });
    return false;
  };

  fastify.get('/api/v1/jobs/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await JobService.get(id);

    if (!job) {
      reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Job not found' } });
      return;
    }

    const allowed = await checkJobAccess(request, reply, job);
    if (!allowed) return;

    return { job };
  });

  fastify.get('/api/v1/jobs/:id/logs', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await JobService.get(id);

    if (!job) {
      reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Job not found' } });
      return;
    }

    const allowed = await checkJobAccess(request, reply, job);
    if (!allowed) return;

    const logs = JobService.getLogs(job);
    reply.type('text/plain').send(logs);
  });
}
