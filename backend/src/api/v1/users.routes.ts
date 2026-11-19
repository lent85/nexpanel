import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../plugins/auth-guard.js';
import { AuthService } from '../../auth/auth-service.js';
import { getDb } from '../../db/index.js';
import { PasswordHasher } from '../../auth/passwords.js';
import { AuditService } from '../../audit/audit.js';

const createUserSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/),
  password: z.string().min(12).optional(),
  role: z.enum(['admin', 'site_manager', 'user', 'client']),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  timezone: z.string().optional(),
  language: z.string().optional()
});

const updateUserSchema = z.object({
  role: z.enum(['admin', 'site_manager', 'user', 'client']).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  timezone: z.string().optional(),
  language: z.string().optional()
});

export async function usersRoutes(fastify: FastifyInstance): Promise<void> {
  // List users
  fastify.get('/api/v1/users', { preHandler: [requirePermission('users:manage')] }, async () => {
    const db = getDb();
    const res = await db.query(
      'SELECT id, email, username, first_name, last_name, role, status, timezone, language, totp_enabled, last_login_at, created_at FROM users WHERE deleted_at IS NULL ORDER BY created_at ASC'
    );
    return { data: res.rows };
  });

  // Create user
  fastify.post('/api/v1/users', { preHandler: [requirePermission('users:manage')] }, async (request) => {
    const body = createUserSchema.parse(request.body);
    const password = body.password || PasswordHasher.generateStrongPassword();

    const result = await AuthService.createUser({
      ...body,
      password,
      ip: request.ip,
      actorUserId: request.user!.sub
    });

    return {
      message: 'User created successfully',
      user: {
        id: result.user.id,
        email: result.user.email,
        username: result.user.username,
        role: result.user.role,
        status: result.user.status
      },
      generatedPassword: body.password ? undefined : password
    };
  });

  // Update user
  fastify.patch('/api/v1/users/:id', { preHandler: [requirePermission('users:manage')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = updateUserSchema.parse(request.body);
    const db = getDb();

    const existing = await db.query('SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (existing.rows.length === 0) {
      reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'User not found' } });
      return;
    }

    const updates: string[] = [];
    const params: any[] = [];
    let idx = 1;

    for (const [key, val] of Object.entries(body)) {
      if (val !== undefined) {
        const dbCol = key === 'firstName' ? 'first_name' : key === 'lastName' ? 'last_name' : key;
        updates.push(`${dbCol} = $${idx++}`);
        params.push(val);
      }
    }

    if (updates.length > 0) {
      params.push(new Date().toISOString());
      params.push(id);
      await db.execute(
        `UPDATE users SET ${updates.join(', ')}, updated_at = $${idx++} WHERE id = $${idx}`,
        params
      );

      await AuditService.log({
        actorUserId: request.user!.sub,
        actorIp: request.ip,
        action: 'user.update',
        entityType: 'user',
        entityId: id,
        after: body
      });
    }

    return { message: 'User updated successfully' };
  });

  // Reset password
  fastify.post('/api/v1/users/:id/reset-password', { preHandler: [requirePermission('users:manage')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const schema = z.object({ password: z.string().min(12).optional() });
    const body = schema.parse(request.body || {});

    const db = getDb();
    const existing = await db.query('SELECT id, username FROM users WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (existing.rows.length === 0) {
      reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'User not found' } });
      return;
    }

    const newPassword = body.password || PasswordHasher.generateStrongPassword();
    const newHash = await PasswordHasher.hash(newPassword);
    const now = new Date().toISOString();

    await db.execute('UPDATE users SET password_hash = $1, updated_at = $2 WHERE id = $3', [newHash, now, id]);

    await AuditService.log({
      actorUserId: request.user!.sub,
      actorIp: request.ip,
      action: 'user.password_reset',
      entityType: 'user',
      entityId: id
    });

    return {
      message: 'Password reset successfully',
      password: newPassword
    };
  });

  // Disable MFA (Emergency recovery & user management)
  fastify.post('/api/v1/users/:id/disable-mfa', { preHandler: [requirePermission('users:manage')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getDb();

    const existing = await db.query('SELECT id, username FROM users WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (existing.rows.length === 0) {
      reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'User not found' } });
      return;
    }

    const now = new Date().toISOString();
    await db.execute('UPDATE users SET totp_enabled = FALSE, totp_secret_ref = NULL, updated_at = $1 WHERE id = $2', [now, id]);

    await AuditService.log({
      actorUserId: request.user!.sub,
      actorIp: request.ip,
      action: 'user.mfa_disabled',
      entityType: 'user',
      entityId: id
    });

    return { message: 'MFA disabled for user successfully' };
  });

  // Soft delete user
  fastify.delete('/api/v1/users/:id', { preHandler: [requirePermission('users:manage')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (id === request.user!.sub) {
      reply.status(400).send({ error: { code: 'CANNOT_DELETE_SELF', message: 'Administrators cannot delete their own account' } });
      return;
    }

    const db = getDb();
    const now = new Date().toISOString();
    await db.execute('UPDATE users SET deleted_at = $1, updated_at = $1 WHERE id = $2', [now, id]);

    await AuditService.log({
      actorUserId: request.user!.sub,
      actorIp: request.ip,
      action: 'user.delete',
      entityType: 'user',
      entityId: id
    });

    return { message: 'User deleted successfully' };
  });
}
