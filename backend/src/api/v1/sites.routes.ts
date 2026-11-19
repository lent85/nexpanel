import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { requirePermission } from '../plugins/auth-guard.js';
import { SiteService } from '../../sites/site-service.js';
import { getDb } from '../../db/index.js';
import { Site } from '../../db/types.js';

const createSiteSchema = z.object({
  domain: z.string().min(3).regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i),
  aliases: z.array(z.string()).optional(),
  type: z.enum(['wordpress', 'php', 'nodejs', 'python', 'static', 'reverse_proxy']),
  phpVersion: z.string().optional(),
  nodeVersion: z.string().optional(),
  pythonVersion: z.string().optional(),
  documentRoot: z.string().optional(),
  dbEngineId: z.string().uuid().optional(),
  varnishEnabled: z.boolean().optional(),
  redisEnabled: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  wordpress: z
    .object({
      siteTitle: z.string().default('My WordPress Site'),
      adminUsername: z.string().default('admin'),
      adminPassword: z.string().optional(),
      adminEmail: z.string().email(),
      dbName: z.string().optional(),
      dbUser: z.string().optional(),
      dbPassword: z.string().optional()
    })
    .optional(),
  reverseProxy: z
    .object({
      upstreamUrl: z.string().url(),
      websocketSupport: z.boolean().optional()
    })
    .optional()
});

const switchPhpSchema = z.object({
  phpVersion: z.string().min(3)
});

const updateVhostSchema = z.object({
  vhost: z.string().min(10)
});

const deleteSiteSchema = z.object({
  confirmDomain: z.string().min(1)
});

export async function sitesRoutes(fastify: FastifyInstance): Promise<void> {
  // 1. List sites (with search and filter)
  fastify.get('/api/v1/sites', { preHandler: [requirePermission('sites:view')] }, async (request) => {
    const db = getDb();
    const query = request.query as any;

    let sql = 'SELECT * FROM sites WHERE deleted_at IS NULL';
    const params: any[] = [];
    let idx = 1;

    if (query.type) {
      sql += ` AND type = $${idx++}`;
      params.push(query.type);
    }
    if (query.status) {
      sql += ` AND status = $${idx++}`;
      params.push(query.status);
    }

    sql += ' ORDER BY created_at DESC';
    const res = await db.query<Site>(sql, params);
    let rows = res.rows;

    // Multi-user RBAC: user and client roles only see assigned/owned sites
    if (request.authContext && (request.authContext.role === 'user' || request.authContext.role === 'client')) {
      const allowedIds = new Set(request.authContext.assignedSiteIds || []);
      rows = rows.filter((r) => allowedIds.has(r.id));
    }

    if (query.search) {
      const q = query.search.toLowerCase();
      rows = rows.filter((r) => r.domain.toLowerCase().includes(q));
    }

    return { data: rows, total: rows.length };
  });

  // 2. Create site (all 6 types)
  fastify.post('/api/v1/sites', { preHandler: [requirePermission('sites:create')] }, async (request) => {
    const body = createSiteSchema.parse(request.body);
    const site = await SiteService.createSite(
      {
        ...body,
        ownerUserId: request.user!.sub
      },
      request.user!.sub,
      request.ip
    );

    return { site, message: 'Site created successfully' };
  });

  // 3. Get site details
  fastify.get('/api/v1/sites/:id', { preHandler: [requirePermission('sites:view')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getDb();
    const res = await db.query<Site>('SELECT * FROM sites WHERE id = $1 AND deleted_at IS NULL', [id]);

    if (res.rows.length === 0) {
      reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Site not found' } });
      return;
    }

    return { site: res.rows[0] };
  });

  // 4. Switch PHP version (FR-SITE-03)
  fastify.post('/api/v1/sites/:id/php-switch', { preHandler: [requirePermission('sites:edit')] }, async (request) => {
    const { id } = request.params as { id: string };
    const body = switchPhpSchema.parse(request.body);
    const site = await SiteService.switchPhpVersion(id, body.phpVersion, request.user!.sub, request.ip);

    return { site, message: `PHP version switched to ${body.phpVersion} successfully` };
  });

  // 5. Get vhost configuration
  fastify.get('/api/v1/sites/:id/vhost', { preHandler: [requirePermission('sites:view')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getDb();
    const res = await db.query<Site>('SELECT * FROM sites WHERE id = $1 AND deleted_at IS NULL', [id]);

    if (res.rows.length === 0) {
      reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Site not found' } });
      return;
    }

    const site = res.rows[0];
    const slug = SiteService.slugifyDomain(site.domain);
    const paths = SiteService.getSitePaths(slug);
    const vhostPath = path.resolve(paths.conf, `${site.domain}.conf`);

    const content = fs.existsSync(vhostPath) ? fs.readFileSync(vhostPath, 'utf8') : '';
    return { vhost: content, domain: site.domain };
  });

  // 6. Update vhost with `nginx -t` gate check (FR-PHP-02)
  fastify.put('/api/v1/sites/:id/vhost', { preHandler: [requirePermission('sites:edit')] }, async (request) => {
    const { id } = request.params as { id: string };
    const body = updateVhostSchema.parse(request.body);
    await SiteService.updateVhost(id, body.vhost, request.user!.sub, request.ip);

    return { message: 'Vhost updated and verified with nginx -t syntax gate' };
  });

  // 7. Soft delete site (FR-SITE-12)
  fastify.delete('/api/v1/sites/:id', { preHandler: [requirePermission('sites:delete')] }, async (request) => {
    const { id } = request.params as { id: string };
    const body = deleteSiteSchema.parse(request.body);
    await SiteService.softDelete(id, body.confirmDomain, request.user!.sub, request.ip);

    return { message: `Site '${body.confirmDomain}' moved to trash (7 days retention)` };
  });

  // 8. Restore site from trash
  fastify.post('/api/v1/sites/:id/restore', { preHandler: [requirePermission('sites:delete')] }, async (request) => {
    const { id } = request.params as { id: string };
    await SiteService.restoreFromTrash(id, request.user!.sub, request.ip);

    return { message: 'Site restored from trash successfully' };
  });
}
