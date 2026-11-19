import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../plugins/auth-guard.js';
import { EngineRegistry } from '../../db-engines/engine-registry.js';

const createEngineSchema = z.object({
  name: z.string().min(2),
  type: z.enum(['mysql', 'mariadb', 'postgres']),
  version: z.string().min(1),
  mode: z.enum(['internal-docker', 'external-docker', 'external-remote']),
  containerName: z.string().optional(),
  image: z.string().optional(),
  volume: z.string().optional(),
  internalPort: z.number().int().positive().optional(),
  externalContainerName: z.string().optional(),
  network: z.string().optional(),
  host: z.string().optional(),
  port: z.number().int().positive().optional(),
  tls: z.boolean().optional(),
  tlsCa: z.string().optional(),
  rootUsername: z.string().min(1),
  rootPassword: z.string().min(1),
  isDefault: z.boolean().optional()
});

const toggleEngineSchema = z.object({
  enabled: z.boolean()
});

export async function dbEnginesRoutes(fastify: FastifyInstance): Promise<void> {
  // 1. List all engines
  fastify.get('/api/v1/db-engines', { preHandler: [requirePermission('engines:manage')] }, async () => {
    const engines = await EngineRegistry.listEngines();
    // Redact password refs for safety
    const safeEngines = engines.map((e) => ({
      ...e,
      root_password_secret_ref: '••••••••'
    }));
    return { data: safeEngines, total: safeEngines.length };
  });

  // 2. Register a new engine
  fastify.post('/api/v1/db-engines', { preHandler: [requirePermission('engines:manage')] }, async (request, reply) => {
    const body = createEngineSchema.parse(request.body);
    const engine = await EngineRegistry.registerEngine(body, request.user!.sub, request.ip);
    reply.status(201).send({
      engine: {
        ...engine,
        root_password_secret_ref: '••••••••'
      },
      message: 'Database engine registered successfully'
    });
  });

  // 3. Get engine by ID
  fastify.get('/api/v1/db-engines/:id', { preHandler: [requirePermission('engines:manage')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const engine = await EngineRegistry.getEngineById(id);
    if (!engine) {
      reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Engine not found' } });
      return;
    }
    return {
      engine: {
        ...engine,
        root_password_secret_ref: '••••••••'
      }
    };
  });

  // 4. Test engine connectivity
  fastify.post('/api/v1/db-engines/:id/test', { preHandler: [requirePermission('engines:manage')] }, async (request) => {
    const { id } = request.params as { id: string };
    const result = await EngineRegistry.testEngine(id);
    return { result };
  });

  // 5. Toggle internal engine enable/disable (Hard Rule R2 protected)
  fastify.post('/api/v1/db-engines/:id/toggle', { preHandler: [requirePermission('engines:manage')] }, async (request) => {
    const { id } = request.params as { id: string };
    const body = toggleEngineSchema.parse(request.body);
    const engine = await EngineRegistry.toggleEngine(id, body.enabled, request.user!.sub, request.ip);
    return {
      engine: {
        ...engine,
        root_password_secret_ref: '••••••••'
      },
      message: `Engine ${body.enabled ? 'enabled' : 'disabled'} successfully`
    };
  });

  // 6. Delete engine from registry
  fastify.delete('/api/v1/db-engines/:id', { preHandler: [requirePermission('engines:manage')] }, async (request) => {
    const { id } = request.params as { id: string };
    await EngineRegistry.deleteEngine(id, request.user!.sub, request.ip);
    return { message: 'Database engine deleted successfully' };
  });
}
