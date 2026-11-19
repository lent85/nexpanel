import { FastifyInstance } from 'fastify';
import { requirePermission } from '../plugins/auth-guard.js';
import { getDb } from '../../db/index.js';
import { Site } from '../../db/types.js';
import { LogService } from '../../logs/log-service.js';
import { SiteService } from '../../sites/site-service.js';

export async function logsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/v1/sites/:id/logs', { preHandler: [requirePermission('sites:view')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as any;
    const db = getDb();

    const res = await db.query<Site>('SELECT * FROM sites WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (res.rows.length === 0) {
      reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Site not found' } });
      return;
    }

    const site = res.rows[0];
    const slug = SiteService.slugifyDomain(site.domain);
    const paths = SiteService.getSitePaths(slug);
    const logType = query.type || 'nginx-access';

    const lines = LogService.readLogs(paths.logs, logType, {
      tail: query.tail ? parseInt(query.tail, 10) : 200,
      search: query.search
    });

    return {
      domain: site.domain,
      type: logType,
      count: lines.length,
      lines
    };
  });
}
