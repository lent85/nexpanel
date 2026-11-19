import { FastifyReply, FastifyRequest } from 'fastify';
import { JwtService, TokenPayload } from '../../auth/jwt.js';
import { AuthContext, PermissionAction, RbacService } from '../../rbac/rbac.js';

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
    request.user = payload;
    request.authContext = {
      userId: payload.sub,
      role: payload.role
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
