import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../plugins/auth-guard.js';
import { DbProvisioner } from '../../db-engines/db-provisioner.js';
import { DumpService } from '../../db-engines/dump-service.js';
import { SsoService } from '../../db-engines/sso-service.js';
import { RedisManager } from '../../db-engines/redis-manager.js';

const createDatabaseSchema = z.object({
  siteId: z.string().uuid().optional(),
  engineId: z.string().uuid().optional(),
  name: z.string().min(2).max(64).regex(/^[a-zA-Z0-9_]+$/, 'Database name must contain only letters, numbers, and underscores'),
  charset: z.string().optional(),
  collation: z.string().optional(),
  user: z.object({
    username: z.string().min(2).max(32).regex(/^[a-zA-Z0-9_]+$/),
    password: z.string().min(8).optional(),
    host: z.string().default('%'),
    privileges: z.enum(['read_write', 'read_only', 'custom']).default('read_write'),
    privilegesList: z.array(z.string()).optional()
  }),
  allowPostgresWordPress: z.boolean().optional()
});

const addUserSchema = z.object({
  username: z.string().min(2).max(32).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8).optional(),
  host: z.string().default('%'),
  privileges: z.enum(['read_write', 'read_only', 'custom']).default('read_write')
});

const resetUserPasswordSchema = z.object({
  password: z.string().min(8).optional()
});

const exportDatabaseSchema = z.object({
  includeStructure: z.boolean().default(true),
  includeData: z.boolean().default(true),
  gzip: z.boolean().default(true)
});

const importDatabaseSchema = z.object({
  sql: z.string().min(1),
  isGzip: z.boolean().default(false)
});

const ssoSchema = z.object({
  userId: z.string().uuid(),
  preferredTool: z.enum(['phpmyadmin', 'adminer', 'pgadmin']).optional()
});

const redisToggleSchema = z.object({
  enabled: z.boolean()
});

export async function databasesRoutes(fastify: FastifyInstance): Promise<void> {
  // 1. List databases (optionally filtered by siteId or engineId)
  fastify.get('/api/v1/databases', { preHandler: [requirePermission('db:view')] }, async (request) => {
    const query = request.query as any;
    const list = await DbProvisioner.listDatabases(query?.siteId, query?.engineId);
    return { data: list, total: list.length };
  });

  // 2. Create database + user atomically (FR-DB-03)
  fastify.post('/api/v1/databases', { preHandler: [requirePermission('db:create')] }, async (request, reply) => {
    const body = createDatabaseSchema.parse(request.body);
    const result = await DbProvisioner.createDatabaseAndUser(body, request.user!.sub, request.ip);
    reply.status(201).send({
      database: result.database,
      user: {
        id: result.user.id,
        username: result.user.username,
        host: result.user.host,
        privileges: result.user.privileges,
        password: result.user.plainPassword
      },
      engine: {
        id: result.engine.id,
        name: result.engine.name,
        type: result.engine.type,
        mode: result.engine.mode
      },
      message: 'Database and user created successfully'
    });
  });

  // 3. Get database details
  fastify.get('/api/v1/databases/:id', { preHandler: [requirePermission('db:view')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const dbRecord = await DbProvisioner.getDatabaseById(id);
    if (!dbRecord) {
      reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Database not found' } });
      return;
    }
    return { database: dbRecord };
  });

  // 4. Delete database
  fastify.delete('/api/v1/databases/:id', { preHandler: [requirePermission('db:delete')] }, async (request) => {
    const { id } = request.params as { id: string };
    await DbProvisioner.deleteDatabase(id, request.user!.sub, request.ip);
    return { message: 'Database deleted successfully' };
  });

  // 5. Add user to database
  fastify.post('/api/v1/databases/:id/users', { preHandler: [requirePermission('db:edit')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = addUserSchema.parse(request.body);
    const user = await DbProvisioner.addUser(
      id,
      body.username,
      body.password,
      body.host,
      body.privileges,
      request.user!.sub,
      request.ip
    );
    reply.status(201).send({
      user: {
        id: user.id,
        username: user.username,
        host: user.host,
        privileges: user.privileges,
        password: user.plainPassword
      },
      message: 'User added to database successfully'
    });
  });

  // 6. Delete user from database
  fastify.delete('/api/v1/databases/:id/users/:userId', { preHandler: [requirePermission('db:edit')] }, async (request) => {
    const { id, userId } = request.params as { id: string; userId: string };
    await DbProvisioner.deleteUser(id, userId, request.user!.sub, request.ip);
    return { message: 'User removed from database successfully' };
  });

  // 7. Reset / change user password
  fastify.post('/api/v1/databases/:id/users/:userId/reset-password', { preHandler: [requirePermission('db:edit')] }, async (request) => {
    const { id, userId } = request.params as { id: string; userId: string };
    const body = resetUserPasswordSchema.parse(request.body || {});
    const res = await DbProvisioner.changeUserPassword(id, userId, body.password, request.user!.sub, request.ip);
    return {
      password: res.plainPassword,
      message: 'Password changed successfully'
    };
  });

  // 8. Export database dump (FR-DB-06)
  fastify.post('/api/v1/databases/:id/export', { preHandler: [requirePermission('db:view')] }, async (request) => {
    const { id } = request.params as { id: string };
    const body = exportDatabaseSchema.parse(request.body || {});
    const exportResult = await DumpService.exportDatabase(id, body, undefined, request.user!.sub, request.ip);
    return {
      export: exportResult,
      message: 'Database exported successfully'
    };
  });

  // 9. Import database dump via background job (FR-DB-06)
  fastify.post('/api/v1/databases/:id/import', { preHandler: [requirePermission('db:edit')] }, async (request) => {
    const { id } = request.params as { id: string };
    const body = importDatabaseSchema.parse(request.body);
    const jobId = await DumpService.importDatabase(id, body.sql, body.isGzip, request.user!.sub, request.ip);
    return {
      jobId,
      message: 'Database import job started'
    };
  });

  // 10. Generate SSO token (FR-DB-05)
  fastify.post('/api/v1/databases/:id/sso', { preHandler: [requirePermission('db:view')] }, async (request) => {
    const { id } = request.params as { id: string };
    const body = ssoSchema.parse(request.body);
    const sso = await SsoService.generateSsoToken(id, body.userId, body.preferredTool);
    return {
      sso,
      message: 'One-click SSO session generated'
    };
  });

  // 11. Redis: Get site Redis configuration (FR-DB-11)
  fastify.get('/api/v1/sites/:siteId/redis', { preHandler: [requirePermission('sites:view')] }, async (request) => {
    const { siteId } = request.params as { siteId: string };
    const config = await RedisManager.getSiteRedisConfig(siteId);
    return { config };
  });

  // 12. Redis: Toggle site Redis
  fastify.post('/api/v1/sites/:siteId/redis/toggle', { preHandler: [requirePermission('sites:edit')] }, async (request) => {
    const { siteId } = request.params as { siteId: string };
    const body = redisToggleSchema.parse(request.body);
    const config = await RedisManager.configureSiteRedis(siteId, body.enabled, request.user!.sub, request.ip);
    return {
      config,
      message: `Redis cache ${body.enabled ? 'enabled' : 'disabled'} for site`
    };
  });

  // 13. Redis: Flush site Redis
  fastify.post('/api/v1/sites/:siteId/redis/flush', { preHandler: [requirePermission('sites:edit')] }, async (request) => {
    const { siteId } = request.params as { siteId: string };
    const result = await RedisManager.flushSiteRedis(siteId, request.user!.sub, request.ip);
    return result;
  });
}
