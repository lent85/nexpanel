import { FastifyInstance } from 'fastify';
import { brand } from '../../config/brand.js';
import { getDb } from '../../db/index.js';
import { VaultService } from '../../vault/vault.js';
import { getEnv } from '../../config/env.js';

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  // Liveness check
  fastify.get('/health', async () => {
    return {
      status: 'ok',
      app: brand.name,
      version: brand.version,
      timestamp: new Date().toISOString()
    };
  });

  // Readiness check
  fastify.get('/health/ready', async (request, reply) => {
    const checks: Record<string, { ok: boolean; message?: string }> = {};
    let isReady = true;

    // Check 1: Panel DB
    try {
      const db = getDb();
      await db.query('SELECT 1');
      checks.database = { ok: true };
    } catch (err: any) {
      checks.database = { ok: false, message: err.message };
      isReady = false;
    }

    // Check 2: Vault
    try {
      const env = getEnv();
      const vault = new VaultService(env.VAULT_KEY_PATH);
      vault.getKey();
      checks.vault = { ok: true };
    } catch (err: any) {
      checks.vault = { ok: false, message: err.message };
      isReady = false;
    }

    if (!isReady) {
      reply.status(503);
    }

    return {
      status: isReady ? 'ready' : 'degraded',
      checks,
      timestamp: new Date().toISOString()
    };
  });
}
