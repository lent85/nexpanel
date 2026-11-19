import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthService } from '../../auth/auth-service.js';
import { authenticate } from '../plugins/auth-guard.js';
import { TotpService } from '../../auth/totp.js';
import { getDb } from '../../db/index.js';
import { AuditService } from '../../audit/audit.js';

const setupSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/),
  password: z.string().min(12)
});

const loginSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
  totpToken: z.string().optional(),
  recoveryCode: z.string().optional()
});

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/v1/auth/setup-status', async () => {
    const isSetup = await AuthService.isSetupMode();
    const canWeb = await AuthService.canUseWebSetup();
    return {
      setupRequired: isSetup,
      webSetupAllowed: canWeb
    };
  });

  fastify.post('/api/v1/auth/setup', async (request, reply) => {
    const body = setupSchema.parse(request.body);
    const ip = request.ip;
    const result = await AuthService.registerFirstAdmin({
      ...body,
      ip
    });

    return {
      message: 'Initial administrator registered successfully',
      user: {
        id: result.user.id,
        email: result.user.email,
        username: result.user.username,
        role: result.user.role
      },
      tokens: {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken
      }
    };
  });

  fastify.post('/api/v1/auth/login', async (request) => {
    const body = loginSchema.parse(request.body);
    const ip = request.ip;
    const userAgent = request.headers['user-agent'];

    const result = await AuthService.login({
      ...body,
      ip,
      userAgent
    });

    if (result.requires2Fa) {
      return {
        requires2Fa: true,
        temp2FaToken: result.temp2FaToken
      };
    }

    return {
      user: {
        id: result.user.id,
        email: result.user.email,
        username: result.user.username,
        role: result.user.role,
        totpEnabled: result.user.totpEnabled
      },
      tokens: {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken
      }
    };
  });

  fastify.get('/api/v1/auth/me', { preHandler: [authenticate] }, async (request) => {
    const db = getDb();
    const res = await db.query('SELECT id, email, username, first_name, last_name, role, status, timezone, language, totp_enabled FROM users WHERE id = $1', [request.user!.sub]);
    if (res.rows.length === 0) {
      throw new Error('User not found');
    }
    return { user: res.rows[0] };
  });

  fastify.post('/api/v1/auth/totp/setup', { preHandler: [authenticate] }, async (request) => {
    const setup = await TotpService.generateSetup(request.user!.username);
    return {
      secret: setup.secret,
      qrCodeUrl: setup.qrCodeUrl,
      otpauthUrl: setup.otpauthUrl,
      recoveryCodes: setup.recoveryCodes
    };
  });

  fastify.post('/api/v1/auth/totp/verify', { preHandler: [authenticate] }, async (request, reply) => {
    const schema = z.object({
      secret: z.string().min(16),
      token: z.string().length(6)
    });
    const body = schema.parse(request.body);
    const isValid = TotpService.verify(body.token, body.secret);

    if (!isValid) {
      reply.status(400).send({ error: { code: 'INVALID_TOTP', message: 'Invalid verification code' } });
      return;
    }

    const db = getDb();
    const now = new Date().toISOString();
    await db.execute(
      'UPDATE users SET totp_enabled = TRUE, totp_secret_ref = $1, updated_at = $2 WHERE id = $3',
      [body.secret, now, request.user!.sub]
    );

    await AuditService.log({
      actorUserId: request.user!.sub,
      actorIp: request.ip,
      action: 'auth.totp.enabled',
      entityType: 'user',
      entityId: request.user!.sub
    });

    return { message: 'Two-factor authentication enabled successfully' };
  });
}
