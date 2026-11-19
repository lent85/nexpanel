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

    if (payload.type !== 'access') {
      reply.status(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid token type: expected access token'
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

    const siteId = (request.params as any)?.siteId || (request.params as any)?.id;
    if (!RbacService.can(request.authContext, action, siteId)) {
      reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: `Role '${request.authContext.role}' lacks permission '${action}'`
        }
      });
    }
  };
}
