import { FastifyInstance } from 'fastify';
import { authenticate } from '../plugins/auth-guard.js';
import { JobService } from '../../jobs/job-service.js';

export async function jobsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/v1/jobs/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await JobService.get(id);

    if (!job) {
      reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Job not found' } });
      return;
    }

    return { job };
  });

  fastify.get('/api/v1/jobs/:id/logs', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await JobService.get(id);

    if (!job) {
      reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Job not found' } });
      return;
    }

    const logs = JobService.getLogs(job);
    reply.type('text/plain').send(logs);
  });
}
