import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { NpmEdgeProvider } from '../src/edge/npm-provider.js';
import { NpmClient } from '../src/edge/npm-client.js';
import { DriftReconciler } from '../src/edge/drift-reconciler.js';
import { ProxyQueue } from '../src/edge/proxy-queue.js';
import { buildApp } from '../src/app.js';
import { setDb } from '../src/db/index.js';
import { MemoryAdapter } from '../src/db/memory-adapter.js';
import { setMockEdgeProvider } from '../src/api/v1/edge.routes.js';
import { EdgeHost, ProxyHostInput } from '../src/edge/types.js';

class MockNpmClient extends NpmClient {
  public hosts: Map<number, any> = new Map();
  public certs: Map<number, any> = new Map();
  public accessLists: Map<number, any> = new Map();
  public isOnline: boolean = true;
  private nextId = 100;

  constructor() {
    super({ baseUrl: 'http://mock-npm:81', adminEmail: 'admin@example.com', adminPassword: 'secret' });
  }

  public override async health(): Promise<{ ok: boolean; version?: string }> {
    if (!this.isOnline) return { ok: false };
    return { ok: true, version: '2.16.0' };
  }

  public override async getHosts(): Promise<any[]> {
    if (!this.isOnline) throw new Error('NPM Connection refused');
    return Array.from(this.hosts.values());
  }

  public override async createHost(payload: Record<string, unknown>): Promise<any> {
    if (!this.isOnline) throw new Error('NPM Connection refused');
    const id = this.nextId++;
    const host = { id, ...payload, enabled: payload.enabled !== false };
    this.hosts.set(id, host);
    return host;
  }

  public override async updateHost(id: number, payload: Record<string, unknown>): Promise<any> {
    if (!this.isOnline) throw new Error('NPM Connection refused');
    const existing = this.hosts.get(id);
    if (!existing) throw new Error('Host not found');
    const updated = { ...existing, ...payload };
    this.hosts.set(id, updated);
    return updated;
  }

  public override async deleteHost(id: number): Promise<void> {
    if (!this.isOnline) throw new Error('NPM Connection refused');
    this.hosts.delete(id);
  }

  public override async enableHost(id: number): Promise<void> {
    if (!this.isOnline) throw new Error('NPM Connection refused');
    const existing = this.hosts.get(id);
    if (existing) existing.enabled = true;
  }

  public override async disableHost(id: number): Promise<void> {
    if (!this.isOnline) throw new Error('NPM Connection refused');
    const existing = this.hosts.get(id);
    if (existing) existing.enabled = false;
  }

  public override async getCertificates(): Promise<any[]> {
    return Array.from(this.certs.values());
  }

  public override async createCertificate(payload: Record<string, unknown>): Promise<any> {
    const id = this.nextId++;
    const cert = { id, ...payload, expires_on: '2027-01-01T00:00:00Z' };
    this.certs.set(id, cert);
    return cert;
  }

  public override async createAccessList(payload: Record<string, unknown>): Promise<any> {
    const id = this.nextId++;
    const al = { id, ...payload };
    this.accessLists.set(id, al);
    return al;
  }
}

describe('Milestone 3 External NPM Integration (R1)', () => {
  let mockClient: MockNpmClient;
  let provider: NpmEdgeProvider;
  let memoryDb: MemoryAdapter;
  let app: any;

  beforeEach(async () => {
    mockClient = new MockNpmClient();
    provider = new NpmEdgeProvider(mockClient);
    setMockEdgeProvider(provider);
    ProxyQueue.clear();

    memoryDb = new MemoryAdapter();
    setDb(memoryDb);
    app = await buildApp();
  });

  it('enforces R1 forward_host rule: rejects localhost and 127.0.0.1 with guidance', async () => {
    // 1. Direct validation check
    assert.throws(
      () => NpmEdgeProvider.validateForwardHost('localhost'),
      /Docker container or service name/
    );
    assert.throws(
      () => NpmEdgeProvider.validateForwardHost('127.0.0.1'),
      /Docker container or service name/
    );
    assert.throws(
      () => NpmEdgeProvider.validateForwardHost('127.0.0.50'),
      /Docker container or service name/
    );

    // 2. Valid container names pass cleanly
    assert.doesNotThrow(() => NpmEdgeProvider.validateForwardHost('site-wordpress-web'));
    assert.doesNotThrow(() => NpmEdgeProvider.validateForwardHost('site-node-app'));
  });

  it('manages proxy-host lifecycle via NPM API', async () => {
    // Create host
    const input: ProxyHostInput = {
      domainNames: ['example.com', 'www.example.com'],
      forwardScheme: 'http',
      forwardHost: 'site-example-web',
      forwardPort: 8080,
      sslForced: true,
      hstsEnabled: true,
      http2Support: true,
      websocketSupport: true
    };

    const created = await provider.createHost(input);
    assert.ok(created.edgeId);
    assert.strictEqual(mockClient.hosts.has(created.edgeId), true);

    const liveHost = mockClient.hosts.get(created.edgeId);
    assert.strictEqual(liveHost.forward_host, 'site-example-web');
    assert.strictEqual(liveHost.forward_port, 8080);
    assert.strictEqual(liveHost.ssl_forced, true);

    // Update host
    await provider.updateHost(created.edgeId, { forwardPort: 9000 });
    assert.strictEqual(mockClient.hosts.get(created.edgeId).forward_port, 9000);

    // Disable / Enable
    await provider.setHostEnabled(created.edgeId, false);
    assert.strictEqual(mockClient.hosts.get(created.edgeId).enabled, false);
    await provider.setHostEnabled(created.edgeId, true);
    assert.strictEqual(mockClient.hosts.get(created.edgeId).enabled, true);

    // Delete host
    await provider.deleteHost(created.edgeId);
    assert.strictEqual(mockClient.hosts.has(created.edgeId), false);
  });

  it('queues mutations when NPM is down and drains on recovery (FR-PROXY-07)', async () => {
    // 1. Mark mock client offline
    mockClient.isOnline = false;

    // Two local hosts can share an origin. Only the queued record should be updated.
    await memoryDb.execute('INSERT INTO proxy_hosts (id, forward_host, edge_host_id) VALUES ($1, $2, $3)',
      ['queued-host', 'site-queued-web', 0]);
    await memoryDb.execute('INSERT INTO proxy_hosts (id, forward_host, edge_host_id) VALUES ($1, $2, $3)',
      ['other-host', 'site-queued-web', 777]);
    await ProxyQueue.enqueue({
      action: 'create',
      proxyHostId: 'queued-host',
      payload: {
        domainNames: ['queued.example.com'],
        forwardScheme: 'http',
        forwardHost: 'site-queued-web',
        forwardPort: 8080
      }
    });

    assert.strictEqual(ProxyQueue.getPending().length, 1);

    // 3. Attempt drain while still offline -> fails safely, keeps in queue
    const drain1 = await ProxyQueue.drain(provider);
    assert.strictEqual(drain1.processed, 0);
    assert.strictEqual(drain1.remaining, 1);

    // 4. Bring NPM back online
    mockClient.isOnline = true;

    // 5. Drain queue -> succeeds
    const drain2 = await ProxyQueue.drain(provider);
    assert.strictEqual(drain2.processed, 1);
    assert.strictEqual(drain2.remaining, 0);

    const edgeHosts = await provider.listHosts();
    const edgeHost = edgeHosts.find((h) => h.domainNames.includes('queued.example.com'));
    assert.ok(edgeHost);
    const { rows } = await memoryDb.query('SELECT * FROM proxy_hosts');
    assert.equal(rows.find((row) => row.id === 'queued-host').edge_host_id, edgeHost.id);
    assert.equal(rows.find((row) => row.id === 'other-host').edge_host_id, 777);
    assert.equal((await memoryDb.query('SELECT * FROM proxy_mutation_queue')).rowCount, 0);
  });

  it('detects drift and performs 1-click reconciliation', async () => {
    // Seed Panel DB with 2 expected proxy hosts
    await memoryDb.execute(
      `INSERT INTO proxy_hosts (id, edge_provider_id, edge_host_id, domain_names, forward_scheme, forward_host, forward_port, ssl_forced, hsts, http2, websocket, enabled, drift_status, created_at, updated_at)
       VALUES ('ph-1', 'prov-1', 101, $1, 'http', 'site-1-web', 8080, true, false, true, false, true, 'in_sync', '2026-01-01', '2026-01-01')`,
      [['site1.example.com']]
    );

    await memoryDb.execute(
      `INSERT INTO proxy_hosts (id, edge_provider_id, edge_host_id, domain_names, forward_scheme, forward_host, forward_port, ssl_forced, hsts, http2, websocket, enabled, drift_status, created_at, updated_at)
       VALUES ('ph-2', 'prov-1', 102, $1, 'http', 'site-2-web', 8080, true, false, true, false, true, 'in_sync', '2026-01-01', '2026-01-01')`,
      [['site2.example.com']]
    );

    // Configure Edge state:
    // - Host 101 matches exactly (in_sync)
    // - Host 102 is missing on edge (missing_on_edge)
    // - Host 200 is an unmanaged host (orphan_on_edge)
    mockClient.hosts.set(101, {
      id: 101,
      domain_names: ['site1.example.com'],
      forward_scheme: 'http',
      forward_host: 'site-1-web',
      forward_port: 8080,
      enabled: true
    });

    mockClient.hosts.set(200, {
      id: 200,
      domain_names: ['orphan.external.com'],
      forward_scheme: 'http',
      forward_host: 'orphan-container',
      forward_port: 3000,
      enabled: true
    });

    const reconciler = new DriftReconciler(provider);
    const report = await reconciler.analyzeDrift();

    assert.strictEqual(report.inSync, 1);
    assert.strictEqual(report.missingOnEdge, 1);
    assert.strictEqual(report.orphanOnEdge, 1);

    // Execute 1-click reconciliation
    const result = await reconciler.reconcile(report);
    assert.strictEqual(result.reconciled, 1); // site 2 re-created on edge

    // Re-analyze: missingOnEdge should now be resolved
    const postReport = await reconciler.analyzeDrift();
    assert.strictEqual(postReport.missingOnEdge, 0);
  });

  it('rejects localhost in API route POST /api/v1/edge/proxy-hosts', async () => {
    // Authenticate admin first
    const adminRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      payload: {
        username: 'admin',
        email: 'admin@example.com',
        password: 'AdminPassword!2026'
      }
    });
    const token = JSON.parse(adminRes.body).tokens.accessToken;

    // Attempt to create proxy host targeting localhost
    const failRes = await app.inject({
      method: 'POST',
      url: '/api/v1/edge/proxy-hosts',
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        domainNames: ['bad.example.com'],
        forwardHost: 'localhost',
        forwardPort: 8080
      }
    });

    assert.strictEqual(failRes.statusCode, 400);
    const body = JSON.parse(failRes.body);
    assert.strictEqual(body.error.code, 'INVALID_FORWARD_HOST');
    assert.strictEqual(body.error.message.includes('502 Bad Gateway'), true);
  });
});
