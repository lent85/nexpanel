import { FastifyReply, FastifyRequest } from 'fastify';
import { JwtService, TokenPayload } from '../../auth/jwt.js';
import { AuthContext, PermissionAction, RbacService } from '../../rbac/rbac.js';
import { getDb } from '../../db/index.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: TokenPayload;
    authContext?: AuthContext;
  }
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reply.status(401).send({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing or invalid Authorization header'
      }
    });
    return;
  }

  const token = authHeader.substring(7);
  try {
    const payload = JwtService.verify(token);

    if (payload.type !== 'access' || payload.scopes?.includes('2fa:verify')) {
      reply.status(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid token: access token required. 2FA challenge tokens are restricted.'
        }
      });
      return;
    }

    let assignedSiteIds: string[] | undefined;
    if (payload.role !== 'admin' && payload.role !== 'site_manager') {
      try {
        const db = getDb();
        const owned = await db.query('SELECT id FROM sites WHERE owner_user_id = $1', [payload.sub]);
        const assigned = await db.query('SELECT site_id FROM site_assignments WHERE user_id = $1', [payload.sub]);

        const ids = new Set<string>();
        for (const row of owned.rows as any[]) {
          if (row.id) ids.add(row.id);
        }
        for (const row of assigned.rows as any[]) {
          if (row.site_id) ids.add(row.site_id);
        }
        assignedSiteIds = Array.from(ids);
      } catch {
        assignedSiteIds = [];
      }
    }

    request.user = payload;
    request.authContext = {
      userId: payload.sub,
      role: payload.role,
      assignedSiteIds
    };
  } catch (err: any) {
    reply.status(401).send({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired token'
      }
    });
  }
}

export function requirePermission(action: PermissionAction) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await authenticate(request, reply);
    if (reply.sent) return;

    if (!request.authContext) {
      reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } });
      return;
    }

    const db = getDb();
    const params = (request.params || {}) as any;
    const body = (request.body || {}) as any;
    const query = (request.query || {}) as any;

    let targetSiteId: string | undefined = params?.siteId;

    // Resolve resource IDs to targetSiteId
    if (!targetSiteId && params?.id) {
      const url = request.url;
      if (url.includes('/api/v1/sites')) {
        targetSiteId = params.id;
      } else if (url.includes('/api/v1/databases')) {
        const dbRes = await db.query('SELECT site_id FROM databases WHERE id = $1 AND deleted_at IS NULL', [params.id]);
        if (dbRes.rows.length === 0) {
          reply.status(404).send({ error: { code: 'NOT_FOUND', message: `Database '${params.id}' not found` } });
          return;
        }
        targetSiteId = (dbRes.rows[0] as any)?.site_id;
      } else if (url.includes('/api/v1/cron')) {
        const cronRes = await db.query('SELECT site_id FROM cron_jobs WHERE id = $1', [params.id]);
        if (cronRes.rows.length === 0) {
          reply.status(404).send({ error: { code: 'NOT_FOUND', message: `Cron job '${params.id}' not found` } });
          return;
        }
        targetSiteId = (cronRes.rows[0] as any)?.site_id;
      } else if (url.includes('/api/v1/backups')) {
        const bkpRes = await db.query('SELECT site_id FROM backups WHERE id = $1', [params.id]);
        if (bkpRes.rows.length === 0) {
          reply.status(404).send({ error: { code: 'NOT_FOUND', message: `Backup '${params.id}' not found` } });
          return;
        }
        targetSiteId = (bkpRes.rows[0] as any)?.site_id;
      } else if (url.includes('/api/v1/jobs')) {
        const jobRes = await db.query('SELECT site_id FROM jobs WHERE id = $1', [params.id]);
        if (jobRes.rows.length > 0) {
          targetSiteId = (jobRes.rows[0] as any)?.site_id;
        }
      }
    }

    // Explicit siteId in body or query: enforce site authorization
    const explicitSiteId = body?.siteId || query?.siteId;
    if (explicitSiteId && (request.authContext.role === 'user' || request.authContext.role === 'client')) {
      if (!request.authContext.assignedSiteIds?.includes(explicitSiteId)) {
        reply.status(403).send({
          error: {
            code: 'FORBIDDEN',
            message: `User is not authorized for site '${explicitSiteId}'`
          }
        });
        return;
      }
      if (!targetSiteId) targetSiteId = explicitSiteId;
    }

    if (!RbacService.can(request.authContext, action, targetSiteId)) {
      reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: `Role '${request.authContext.role}' lacks permission '${action}'`
        }
      });
      return;
    }
  };
}
