import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { buildApp } from '../src/app.js';
import { setDb } from '../src/db/index.js';
import { MemoryAdapter } from '../src/db/memory-adapter.js';
import { AuthService } from '../src/auth/auth-service.js';
import { JobService } from '../src/jobs/job-service.js';

describe('Milestone 1 Core Integration', () => {
  let app: any;
  let memoryDb: MemoryAdapter;

  beforeEach(async () => {
    memoryDb = new MemoryAdapter();
    setDb(memoryDb);
    AuthService.setSetupStartTime(Date.now());
    app = await buildApp();
  });

  it('GET /health and GET /health/ready return operational status', async () => {
    const liveRes = await app.inject({ method: 'GET', url: '/health' });
    assert.strictEqual(liveRes.statusCode, 200);
    const liveBody = JSON.parse(liveRes.body);
    assert.strictEqual(liveBody.status, 'ok');
    assert.strictEqual(liveBody.app, 'NexPanel');

    const readyRes = await app.inject({ method: 'GET', url: '/health/ready' });
    assert.strictEqual(readyRes.statusCode, 200);
    const readyBody = JSON.parse(readyRes.body);
    assert.strictEqual(readyBody.status, 'ready');
    assert.strictEqual(readyBody.checks.database.ok, true);
  });

  it('handles first admin setup and blocks subsequent setups', async () => {
    // 1. Initial status -> setupRequired = true
    const statusRes1 = await app.inject({ method: 'GET', url: '/api/v1/auth/setup-status' });
    assert.strictEqual(JSON.parse(statusRes1.body).setupRequired, true);

    // 2. Register first admin
    const setupRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      payload: {
        username: 'admin',
        email: 'admin@example.com',
        password: 'AdminSuperPassword!2026'
      }
    });

    assert.strictEqual(setupRes.statusCode, 200);
    const setupData = JSON.parse(setupRes.body);
    assert.strictEqual(setupData.user.role, 'admin');
    assert.ok(setupData.tokens.accessToken);

    // 3. Second setup attempt must fail (closed)
    const secondSetup = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      payload: {
        username: 'attacker',
        email: 'attacker@example.com',
        password: 'AttackerPassword!2026'
      }
    });
    assert.strictEqual(secondSetup.statusCode, 400);

    // 4. Status reflects setup complete
    const statusRes2 = await app.inject({ method: 'GET', url: '/api/v1/auth/setup-status' });
    assert.strictEqual(JSON.parse(statusRes2.body).setupRequired, false);
  });

  it('locks setup mode after 15 minutes window (NFR-SEC-02)', async () => {
    // Simulate setup window expiration (> 15 minutes ago)
    AuthService.setSetupStartTime(Date.now() - 16 * 60 * 1000);

    const setupRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      payload: {
        username: 'late_admin',
        email: 'late@example.com',
        password: 'LatePassword!2026'
      }
    });

    assert.strictEqual(setupRes.statusCode, 403);
    const body = JSON.parse(setupRes.body);
    assert.strictEqual(body.error.message.includes('Setup mode expired after 15 minutes'), true);

    // Reset setup start time for subsequent tests
    AuthService.setSetupStartTime(Date.now());
  });

  it('enforces brute force lockout on 5 failed attempts (NFR-SEC-06)', async () => {
    // Create an admin first
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      payload: {
        username: 'admin',
        email: 'admin@example.com',
        password: 'CorrectPassword!2026'
      }
    });

    // 5 failed login attempts
    for (let i = 0; i < 5; i++) {
      const failRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          identifier: 'admin',
          password: 'WrongPassword!'
        }
      });
      assert.strictEqual(failRes.statusCode, 401);
    }

    // 6th attempt -> Locked out with 429
    const lockedRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        identifier: 'admin',
        password: 'CorrectPassword!2026'
      }
    });
    assert.strictEqual(lockedRes.statusCode, 429);
    assert.strictEqual(JSON.parse(lockedRes.body).error.message.includes('Account locked'), true);
  });

  it('manages user lifecycle and enforces RBAC guards', async () => {
    // 1. Setup admin
    const setupRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      payload: {
        username: 'admin',
        email: 'admin@example.com',
        password: 'AdminPassword!2026'
      }
    });
    const adminToken = JSON.parse(setupRes.body).tokens.accessToken;

    // 2. Admin creates a Site Manager
    const createMgrRes = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        username: 'manager',
        email: 'manager@example.com',
        password: 'ManagerPassword!2026',
        role: 'site_manager'
      }
    });
    assert.strictEqual(createMgrRes.statusCode, 200);

    // 3. Manager logs in
    const mgrLoginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        identifier: 'manager',
        password: 'ManagerPassword!2026'
      }
    });
    assert.strictEqual(mgrLoginRes.statusCode, 200);
    const mgrToken = JSON.parse(mgrLoginRes.body).tokens.accessToken;

    // 4. Manager attempts to access Admin Area route (must be 403 Forbidden)
    const mgrAccessRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/events',
      headers: { Authorization: `Bearer ${mgrToken}` }
    });
    assert.strictEqual(mgrAccessRes.statusCode, 403);

    // 5. Admin accesses Admin Area events -> 200 OK
    const adminAccessRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/events',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(adminAccessRes.statusCode, 200);
    const events = JSON.parse(adminAccessRes.body);
    assert.strictEqual(events.data.length > 0, true);
  });

  it('executes background jobs with live progress and logs', async () => {
    let jobExecuted = false;

    JobService.registerHandler('test.echo', async (job, updateProgress, log) => {
      log('Starting test execution');
      await updateProgress(50, 'Halfway done');
      log('Finishing test execution');
      await updateProgress(100, 'All done');
      jobExecuted = true;
      return { success: true };
    });

    const job = await JobService.enqueue({
      type: 'test.echo',
      payload: { testData: 123 },
      idempotencyKey: 'test-key-1'
    });

    assert.ok(job.id);

    // Give asynchronous execution loop a tick
    await new Promise((r) => setTimeout(r, 100));

    const updatedJob = await JobService.get(job.id);
    assert.strictEqual(updatedJob?.status, 'done');
    assert.strictEqual(updatedJob?.progressPct, 100);
    assert.strictEqual(jobExecuted, true);

    const logs = JobService.getLogs(updatedJob!);
    assert.strictEqual(logs.includes('Starting test execution'), true);
    assert.strictEqual(logs.includes('Finishing test execution'), true);
  });
});
