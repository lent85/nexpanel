import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as http from 'node:http';
import { execSync } from 'node:child_process';
import { NpmClient } from '../src/edge/npm-client.js';
import { NpmEdgeProvider } from '../src/edge/npm-provider.js';
import { DriftReconciler } from '../src/edge/drift-reconciler.js';
import { setDb } from '../src/db/index.js';
import { MemoryAdapter } from '../src/db/memory-adapter.js';

function requestHttp(options: {
  host?: string;
  port?: number;
  path?: string;
  headers?: Record<string, string>;
}): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: options.host || '127.0.0.1',
        port: options.port || 80,
        path: options.path || '/',
        headers: options.headers || {}
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => resolve({ statusCode: res.statusCode || 0, body }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

describe('Milestone 3 Live NPM & External Network Integration (R1)', () => {
  const npmBaseUrl = process.env.LIVE_NPM_BASE_URL || 'http://127.0.0.1:81';
  const npmAdminEmail = process.env.LIVE_NPM_EMAIL || 'admin@example.com';
  const npmAdminPassword = process.env.LIVE_NPM_PASSWORD || 'changeme';

  const client = new NpmClient({
    baseUrl: npmBaseUrl,
    adminEmail: npmAdminEmail,
    adminPassword: npmAdminPassword
  });
  const provider = new NpmEdgeProvider(client);

  let isNpmLive = false;
  let testEdgeHostId: number | null = null;
  let testAccessListId: number | null = null;

  before(async () => {
    try {
      const health = await client.health();
      if (health.ok) {
        isNpmLive = true;
      }
    } catch {
      isNpmLive = false;
    }

    if (!isNpmLive) {
      console.log('NOTICE: Live NPM container is not reachable at', npmBaseUrl, '— skipping live integration tests.');
      return;
    }

    // Ensure test-origin-site container exists on network proxy
    try {
      execSync('docker inspect test-origin-site', { stdio: 'ignore' });
    } catch {
      try {
        execSync(
          'docker run -d --name test-origin-site --network proxy nginx:alpine && ' +
            'docker exec test-origin-site sh -c \'echo "<h1>Hello from NexPanel Test Origin Site via NPM!</h1>" > /usr/share/nginx/html/index.html\'',
          { stdio: 'ignore' }
        );
      } catch (err) {
        console.warn('Could not launch test-origin-site container:', err);
      }
    }
  });

  after(async () => {
    if (!isNpmLive) return;

    // Clean up created proxy host
    if (testEdgeHostId) {
      try {
        await provider.deleteHost(testEdgeHostId);
      } catch {}
    }

    // Clean up created access list
    if (testAccessListId) {
      try {
        await client.request(`nginx/access-lists/${testAccessListId}`, { method: 'DELETE' });
      } catch {}
    }
  });

  it('verifies live NPM health, version 2.16.0, and JWT token acquisition', async (t) => {
    if (!isNpmLive) return t.skip('Live NPM not running');

    const health = await provider.verifyConnection();
    assert.strictEqual(health.ok, true);
    assert.strictEqual(typeof health.version, 'string');
    assert.strictEqual(health.version?.includes('2.16'), true);

    const token = await client.getValidToken();
    assert.strictEqual(typeof token, 'string');
    assert.strictEqual(token.length > 50, true);
  });

  it('enforces Hard Rule R1: rejects localhost and 127.0.0.1 forward hosts', (t) => {
    if (!isNpmLive) return t.skip('Live NPM not running');

    assert.throws(
      () => NpmEdgeProvider.validateForwardHost('localhost'),
      /causes a 502 Bad Gateway/
    );
    assert.throws(
      () => NpmEdgeProvider.validateForwardHost('127.0.0.1'),
      /causes a 502 Bad Gateway/
    );
    assert.throws(
      () => NpmEdgeProvider.validateForwardHost('::1'),
      /causes a 502 Bad Gateway/
    );
  });

  it('creates a live proxy host routing domain to Docker container on proxy network', async (t) => {
    if (!isNpmLive) return t.skip('Live NPM not running');

    const created = await provider.createHost({
      domainNames: ['test-origin.example.local'],
      forwardScheme: 'http',
      forwardHost: 'test-origin-site',
      forwardPort: 80,
      sslForced: false,
      hstsEnabled: false,
      http2Support: true,
      websocketSupport: true,
      enabled: true
    });

    assert.strictEqual(typeof created.edgeId, 'number');
    assert.strictEqual(created.edgeId > 0, true);
    testEdgeHostId = created.edgeId;

    // Verify it exists in NPM
    const host = await client.getHost(testEdgeHostId);
    assert.strictEqual(host.id, testEdgeHostId);
    assert.deepStrictEqual(host.domain_names, ['test-origin.example.local']);
    assert.strictEqual(host.forward_host, 'test-origin-site');
    assert.strictEqual(host.forward_port, 80);
  });

  it('verifies end-to-end HTTP reverse proxying via port 80 across Docker proxy network', async (t) => {
    if (!isNpmLive) return t.skip('Live NPM not running');
    if (!testEdgeHostId) return t.skip('Proxy host not created');

    // Give Nginx inside NPM 1.5 seconds to reload configuration
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Request through port 80 (NPM) using explicit Host header
    const res = await requestHttp({
      host: '127.0.0.1',
      port: 80,
      path: '/',
      headers: {
        Host: 'test-origin.example.local'
      }
    });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.includes('Hello from NexPanel Test Origin Site via NPM!'), true);
  });

  it('creates and attaches Access List (Basic Auth) in NPM and verifies protection', async (t) => {
    if (!isNpmLive) return t.skip('Live NPM not running');
    if (!testEdgeHostId) return t.skip('Proxy host not created');

    // 1. Create access list in NPM
    const aclRes = await client.createAccessList({
      name: 'Test ACL Protection',
      satisfy_any: false,
      pass_auth: false,
      items: [
        {
          username: 'proxyuser',
          password: 'SecretPass123!'
        }
      ],
      clients: []
    });

    assert.strictEqual(typeof aclRes.id, 'number');
    testAccessListId = aclRes.id;

    // 2. Attach access list to the proxy host
    await provider.updateHost(testEdgeHostId, {
      accessListId: testAccessListId
    });

    // Wait for Nginx to reload
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // 3. Request without authentication should return 401 Unauthorized
    const unauthRes = await requestHttp({
      host: '127.0.0.1',
      port: 80,
      path: '/',
      headers: {
        Host: 'test-origin.example.local'
      }
    });
    assert.strictEqual(unauthRes.statusCode, 401);

    // 4. Request with Basic Auth should succeed (200 OK)
    const credentials = Buffer.from('proxyuser:SecretPass123!').toString('base64');
    const authRes = await requestHttp({
      host: '127.0.0.1',
      port: 80,
      path: '/',
      headers: {
        Host: 'test-origin.example.local',
        Authorization: `Basic ${credentials}`
      }
    });
    assert.strictEqual(authRes.statusCode, 200);
    assert.strictEqual(authRes.body.includes('Hello from NexPanel Test Origin Site via NPM!'), true);

    // Detach access list before subsequent test
    await provider.updateHost(testEdgeHostId, { accessListId: 0 });
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  it('runs DriftReconciler against live NPM to detect and fix configuration drift', async (t) => {
    if (!isNpmLive) return t.skip('Live NPM not running');
    if (!testEdgeHostId) return t.skip('Proxy host not created');

    // Setup in-memory panel DB
    const db = new MemoryAdapter();
    await db.migrate();
    setDb(db);

    // Insert panel record expecting port 80 (matching desired state)
    await db.execute(
      `INSERT INTO proxy_hosts (id, edge_provider_id, edge_host_id, domain_names, forward_scheme, forward_host, forward_port, ssl_forced, hsts, http2, websocket, enabled, drift_status, created_at, updated_at)
       VALUES ('ph-1', 'prov-1', $1, $2, 'http', 'test-origin-site', 80, false, false, true, true, true, 'in_sync', '2026-01-01', '2026-01-01')`,
      [testEdgeHostId, ['test-origin.example.local']]
    );

    const reconciler = new DriftReconciler(provider);

    // Analyze: should have in_sync item
    const initialReport = await reconciler.analyzeDrift();
    const item = initialReport.items.find((i) => i.domain === 'test-origin.example.local');
    assert.strictEqual(item?.status, 'in_sync');

    // Introduce drift: manually alter port in NPM to 8080
    await client.updateHost(testEdgeHostId, { forward_port: 8080 });

    const driftedReport = await reconciler.analyzeDrift();
    const driftedItem = driftedReport.items.find((i) => i.domain === 'test-origin.example.local');
    assert.strictEqual(driftedItem?.status, 'drifted');
    assert.strictEqual(driftedItem?.differences?.forwardPort?.panel, 80);
    assert.strictEqual(driftedItem?.differences?.forwardPort?.edge, 8080);

    // Execute 1-click reconciliation to sync from panel -> NPM
    const fixReport = await reconciler.reconcile(driftedReport);
    assert.strictEqual(fixReport.reconciled >= 1, true);

    // Verify NPM is back in sync (forward_port is 80 again)
    const fixedHost = await client.getHost(testEdgeHostId);
    assert.strictEqual(fixedHost.forward_port, 80);
  });

  it('disables, enables, and deletes proxy host in live NPM cleanly', async (t) => {
    if (!isNpmLive) return t.skip('Live NPM not running');
    if (!testEdgeHostId) return t.skip('Proxy host not created');

    // 1. Disable host
    await provider.setHostEnabled(testEdgeHostId, false);
    let host = await client.getHost(testEdgeHostId);
    assert.strictEqual(Boolean(host.enabled), false);

    // 2. Enable host
    await provider.setHostEnabled(testEdgeHostId, true);
    host = await client.getHost(testEdgeHostId);
    assert.strictEqual(Boolean(host.enabled), true);

    // 3. Delete host
    await provider.deleteHost(testEdgeHostId);
    testEdgeHostId = null;

    const remainingHosts = await client.getHosts();
    assert.strictEqual(remainingHosts.some((h) => h.domain_names.includes('test-origin.example.local')), false);
  });
});
