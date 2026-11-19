import { FastifyInstance } from 'fastify';
import { requirePermission } from '../plugins/auth-guard.js';
import { AuditService } from '../../audit/audit.js';
import { getEnv } from '../../config/env.js';
import { brand } from '../../config/brand.js';

export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  // Audit events listing
  fastify.get('/api/v1/admin/events', { preHandler: [requirePermission('admin:access')] }, async (request) => {
    const query = request.query as any;
    const page = query.page ? parseInt(query.page, 10) : 1;
    const perPage = query.per_page ? parseInt(query.per_page, 10) : 25;

    const result = await AuditService.list({
      action: query.action,
      entityType: query.entity_type,
      actorUserId: query.actor_user_id,
      page,
      perPage
    });

    return {
      data: result.data,
      meta: {
        total: result.total,
        page,
        per_page: perPage
      }
    };
  });

  // Audit events export CSV
  fastify.get('/api/v1/admin/events/export', { preHandler: [requirePermission('admin:access')] }, async (request, reply) => {
    const result = await AuditService.list({ perPage: 10000 });
    const csv = AuditService.exportCsv(result.data);

    reply
      .header('Content-Type', 'text/csv')
      .header('Content-Disposition', 'attachment; filename="audit-events.csv"')
      .send(csv);
  });

  // Instance Settings
  fastify.get('/api/v1/admin/settings', { preHandler: [requirePermission('settings:manage')] }, async () => {
    const env = getEnv();
    return {
      settings: {
        brandName: brand.name,
        cliName: brand.cliName,
        version: brand.version,
        panelDomain: env.PANEL_DOMAIN,
        panelBaseUrl: env.PANEL_BASE_URL,
        timezone: env.PANEL_TIMEZONE,
        defaultPhp: env.PANEL_DEFAULT_PHP,
        defaultDbEngine: env.PANEL_DEFAULT_DB_ENGINE,
        npmBaseUrl: env.NPM_BASE_URL,
        npmNetwork: env.NPM_NETWORK
      }
    };
  });
}
