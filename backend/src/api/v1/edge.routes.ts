import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v7 as uuidv7 } from 'uuid';
import { requirePermission } from '../plugins/auth-guard.js';
import { getDb } from '../../db/index.js';
import { EdgeProvider as DbEdgeProvider, ProxyHost } from '../../db/types.js';
import { NpmClient } from '../../edge/npm-client.js';
import { NpmEdgeProvider } from '../../edge/npm-provider.js';
import { DriftReconciler } from '../../edge/drift-reconciler.js';
import { ProxyQueue } from '../../edge/proxy-queue.js';
import { VaultService } from '../../vault/vault.js';
import { getEnv } from '../../config/env.js';
import { AuditService } from '../../audit/audit.js';

const providerConfigSchema = z.object({
  name: z.string().default('Nginx Proxy Manager'),
  baseUrl: z.string().url(),
  adminEmail: z.string().email(),
  adminPassword: z.string().optional(),
  apiToken: z.string().optional(),
  networkName: z.string().default('proxy')
});

const proxyHostSchema = z.object({
  siteId: z.string().uuid().optional(),
  domainNames: z.array(z.string().min(1)).min(1),
  forwardScheme: z.enum(['http', 'https']).default('http'),
  forwardHost: z.string().min(1),
  forwardPort: z.number().int().min(1).max(65535).default(8080),
  certificateId: z.number().optional(),
  sslForced: z.boolean().default(false),
  hsts: z.boolean().default(false),
  http2: z.boolean().default(true),
  websocket: z.boolean().default(false),
  accessListId: z.number().optional(),
  enabled: z.boolean().default(true)
});

let mockProviderOverride: NpmEdgeProvider | null = null;

export function setMockEdgeProvider(provider: NpmEdgeProvider | null): void {
  mockProviderOverride = provider;
}

export async function getEdgeProvider(providerId?: string): Promise<{ provider: NpmEdgeProvider; record?: DbEdgeProvider }> {
  if (mockProviderOverride) {
    return { provider: mockProviderOverride };
  }

  const db = getDb();
  let query = 'SELECT * FROM edge_providers WHERE kind = $1';
  let params: any[] = ['npm'];

  if (providerId) {
    query = 'SELECT * FROM edge_providers WHERE id = $1';
    params = [providerId];
  }

  const res = await db.query<DbEdgeProvider>(query, params);
  if (res.rows.length === 0) {
    // Return default instance from environment variables
    const env = getEnv();
    const client = new NpmClient({
      baseUrl: env.NPM_BASE_URL,
      adminEmail: env.NPM_ADMIN_EMAIL,
      adminPassword: env.NPM_ADMIN_PASSWORD
    });
    return { provider: new NpmEdgeProvider(client) };
  }

  const record = res.rows[0];
  const env = getEnv();
  const vault = new VaultService(env.VAULT_KEY_PATH);
  let decryptedCreds: { password?: string; token?: string } = {};

  try {
    const raw = vault.decrypt(record.credentialsSecretRef);
    decryptedCreds = JSON.parse(raw);
  } catch {
    // fallback
  }

  const client = new NpmClient({
    baseUrl: record.baseUrl,
    adminEmail: record.adminEmail,
    adminPassword: decryptedCreds.password,
    apiToken: decryptedCreds.token
  });

  return { provider: new NpmEdgeProvider(client), record };
}

export async function edgeRoutes(fastify: FastifyInstance): Promise<void> {
  // 1. List / Get Edge Providers
  fastify.get('/api/v1/edge/providers', { preHandler: [requirePermission('edge:manage')] }, async () => {
    const db = getDb();
    const res = await db.query('SELECT id, kind, name, base_url, admin_email, network_name, status, version, last_checked_at FROM edge_providers');
    return { data: res.rows };
  });

  // 2. Configure Edge Provider (stores credentials in vault)
  fastify.post('/api/v1/edge/providers', { preHandler: [requirePermission('edge:manage')] }, async (request) => {
    const body = providerConfigSchema.parse(request.body);
    const env = getEnv();
    const vault = new VaultService(env.VAULT_KEY_PATH);

    const credsJson = JSON.stringify({ password: body.adminPassword, token: body.apiToken });
    const encryptedSecretRef = vault.encrypt(credsJson);

    const db = getDb();
    const id = uuidv7();
    const now = new Date().toISOString();

    await db.execute(
      `INSERT INTO edge_providers (id, kind, name, base_url, admin_email, credentials_secret_ref, network_name, status, created_at, updated_at)
       VALUES ($1, 'npm', $2, $3, $4, $5, $6, 'unknown', $7, $8)`,
      [id, body.name, body.baseUrl, body.adminEmail, encryptedSecretRef, body.networkName, now, now]
    );

    await AuditService.log({
      actorUserId: request.user!.sub,
      actorIp: request.ip,
      action: 'edge.provider_configured',
      entityType: 'edge_provider',
      entityId: id,
      after: { name: body.name, baseUrl: body.baseUrl, adminEmail: body.adminEmail }
    });

    return { id, message: 'NPM Edge Provider configured successfully' };
  });

  // 3. Test Connection
  fastify.post('/api/v1/edge/providers/:id/test', { preHandler: [requirePermission('edge:manage')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { provider } = await getEdgeProvider(id);
    const result = await provider.verifyConnection();

    if (!result.ok) {
      reply.status(502).send({
        error: {
          code: 'EDGE_UNREACHABLE',
          message: `Could not connect to NPM API: ${result.error || 'Connection failed'}`
        }
      });
      return;
    }

    const db = getDb();
    await db.execute('UPDATE edge_providers SET status = $1, version = $2, last_checked_at = $3 WHERE id = $4', [
      'reachable',
      result.version,
      new Date().toISOString(),
      id
    ]);

    return { ok: true, version: result.version };
  });

  // 4. Drift Analysis
  fastify.get('/api/v1/edge/providers/:id/reconcile', { preHandler: [requirePermission('edge:manage')] }, async (request) => {
    const { id } = request.params as { id: string };
    const { provider } = await getEdgeProvider(id);
    const reconciler = new DriftReconciler(provider);
    const report = await reconciler.analyzeDrift();
    return { report };
  });

  // 5. 1-Click Reconcile
  fastify.post('/api/v1/edge/providers/:id/reconcile', { preHandler: [requirePermission('edge:manage')] }, async (request) => {
    const { id } = request.params as { id: string };
    const { provider } = await getEdgeProvider(id);
    const reconciler = new DriftReconciler(provider);
    const result = await reconciler.reconcile();

    await AuditService.log({
      actorUserId: request.user!.sub,
      actorIp: request.ip,
      action: 'edge.reconciled',
      entityType: 'edge_provider',
      entityId: id,
      after: result
    });

    return { message: 'Reconciliation complete', ...result };
  });

  // 6. Create Proxy Host (Enforces R1 forward_host rule)
  fastify.post('/api/v1/edge/proxy-hosts', { preHandler: [requirePermission('sites:edit')] }, async (request, reply) => {
    const body = proxyHostSchema.parse(request.body);

    // Validate forward host — R1 Hard Rule
    try {
      NpmEdgeProvider.validateForwardHost(body.forwardHost);
    } catch (err: any) {
      reply.status(400).send({
        error: {
          code: 'INVALID_FORWARD_HOST',
          message: err.message
        }
      });
      return;
    }

    const { provider, record } = await getEdgeProvider();
    const db = getDb();
    const id = uuidv7();
    const now = new Date().toISOString();
    let edgeHostId = 0;

    try {
      const edgeRes = await provider.createHost({
        domainNames: body.domainNames,
        forwardScheme: body.forwardScheme,
        forwardHost: body.forwardHost,
        forwardPort: body.forwardPort,
        certificateId: body.certificateId,
        sslForced: body.sslForced,
        hstsEnabled: body.hsts,
        http2Support: body.http2,
        websocketSupport: body.websocket,
        accessListId: body.accessListId,
        enabled: body.enabled
      });
      edgeHostId = edgeRes.edgeId;
    } catch (err: any) {
      // If NPM is down, queue mutation per FR-PROXY-07
      ProxyQueue.enqueue({
        action: 'create',
        payload: {
          domainNames: body.domainNames,
          forwardScheme: body.forwardScheme,
          forwardHost: body.forwardHost,
          forwardPort: body.forwardPort,
          certificateId: body.certificateId,
          sslForced: body.sslForced,
          hstsEnabled: body.hsts,
          http2Support: body.http2,
          websocketSupport: body.websocket,
          accessListId: body.accessListId,
          enabled: body.enabled
        }
      });
    }

    const hostEntry: ProxyHost = {
      id,
      siteId: body.siteId,
      edgeProviderId: record?.id || id,
      edgeHostId,
      domainNames: body.domainNames,
      forwardScheme: body.forwardScheme,
      forwardHost: body.forwardHost,
      forwardPort: body.forwardPort,
      certificateId: body.certificateId,
      sslForced: body.sslForced,
      hsts: body.hsts,
      http2: body.http2,
      websocket: body.websocket,
      accessListId: body.accessListId,
      enabled: body.enabled,
      driftStatus: edgeHostId ? 'in_sync' : 'missing_on_edge',
      lastSyncedAt: edgeHostId ? now : undefined,
      createdAt: now,
      updatedAt: now
    };

    await db.execute(
      `INSERT INTO proxy_hosts (id, site_id, edge_provider_id, edge_host_id, domain_names, forward_scheme, forward_host, forward_port, certificate_id, ssl_forced, hsts, http2, websocket, access_list_id, enabled, drift_status, last_synced_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
      [
        hostEntry.id,
        hostEntry.siteId || null,
        hostEntry.edgeProviderId,
        hostEntry.edgeHostId,
        hostEntry.domainNames,
        hostEntry.forwardScheme,
        hostEntry.forwardHost,
        hostEntry.forwardPort,
        hostEntry.certificateId || null,
        hostEntry.sslForced,
        hostEntry.hsts,
        hostEntry.http2,
        hostEntry.websocket,
        hostEntry.accessListId || null,
        hostEntry.enabled,
        hostEntry.driftStatus,
        hostEntry.lastSyncedAt || null,
        hostEntry.createdAt,
        hostEntry.updatedAt
      ]
    );

    await AuditService.log({
      actorUserId: request.user!.sub,
      actorIp: request.ip,
      action: 'edge.proxy_host_created',
      entityType: 'proxy_host',
      entityId: hostEntry.id,
      after: { domainNames: hostEntry.domainNames, forwardHost: hostEntry.forwardHost, forwardPort: hostEntry.forwardPort }
    });

    return { proxyHost: hostEntry };
  });

  // 7. Delete Proxy Host
  fastify.delete('/api/v1/edge/proxy-hosts/:id', { preHandler: [requirePermission('sites:delete')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getDb();
    const res = await db.query<ProxyHost>('SELECT * FROM proxy_hosts WHERE id = $1', [id]);

    if (res.rows.length === 0) {
      reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Proxy host not found' } });
      return;
    }

    const host = res.rows[0];
    const { provider } = await getEdgeProvider(host.edgeProviderId);

    if (host.edgeHostId) {
      try {
        await provider.deleteHost(host.edgeHostId);
      } catch (err) {
        // Queue delete if edge is down
        ProxyQueue.enqueue({
          action: 'delete',
          edgeHostId: host.edgeHostId
        });
      }
    }

    await db.execute('DELETE FROM proxy_hosts WHERE id = $1', [id]);

    await AuditService.log({
      actorUserId: request.user!.sub,
      actorIp: request.ip,
      action: 'edge.proxy_host_deleted',
      entityType: 'proxy_host',
      entityId: id,
      after: { domainNames: host.domainNames }
    });

    return { message: 'Proxy host deleted successfully' };
  });
}
