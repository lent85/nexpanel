import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { setDb } from '../src/db/index.js';
import { MemoryAdapter } from '../src/db/memory-adapter.js';
import { AuthService } from '../src/auth/auth-service.js';
import { EngineRegistry } from '../src/db-engines/engine-registry.js';
import { DbProvisioner } from '../src/db-engines/db-provisioner.js';
import { DumpService } from '../src/db-engines/dump-service.js';
import { SsoService } from '../src/db-engines/sso-service.js';
import { RedisManager } from '../src/db-engines/redis-manager.js';
import { SiteService } from '../src/sites/site-service.js';
import { VaultService } from '../src/vault/vault.js';
import { setMockEdgeProvider } from '../src/api/v1/edge.routes.js';
import { NpmEdgeProvider } from '../src/edge/npm-provider.js';

describe('Milestone 5 Database Engines (R2 & FR-DB-01 to 08, 11-12)', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let memoryDb: MemoryAdapter;

  before(async () => {
    memoryDb = new MemoryAdapter();
    setDb(memoryDb);

    const mockEdge = {
      kind: 'npm' as const,
      verifyConnection: async () => ({ ok: true, version: '2.16.0' }),
      createHost: async () => ({ edgeId: 101 }),
      updateHost: async () => {},
      deleteHost: async () => {},
      setHostEnabled: async () => {},
      requestCertificate: async () => ({ edgeCertId: 201 }),
      uploadCertificate: async () => ({ edgeCertId: 202 }),
      listCertificates: async () => [],
      createAccessList: async () => ({ edgeId: 301 }),
      listHosts: async () => []
    } as unknown as NpmEdgeProvider;
    setMockEdgeProvider(mockEdge);

    app = await buildApp();

    AuthService.setSetupStartTime(Date.now());
    const setupRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      payload: {
        username: 'admin',
        email: 'admin@example.com',
        password: 'AdminPassword!2026'
      }
    });
    adminToken = setupRes.json().tokens.accessToken;
  });

  beforeEach(async () => {
    // Initialize default engine
    await EngineRegistry.initDefaultEngines();
  });

  it('initializes default engine (internal MySQL 8.4) and registers 3 engine modes (FR-DB-01, 02)', async () => {
    // 1. Verify default engine
    const defaultEngine = await EngineRegistry.getDefaultEngine();
    assert.strictEqual(defaultEngine.type, 'mysql');
    assert.strictEqual(defaultEngine.version, '8.4');
    assert.strictEqual(defaultEngine.mode, 'internal-docker');
    assert.strictEqual(defaultEngine.is_default, true);

    // 2. Register external-docker MariaDB
    const maria = await EngineRegistry.registerEngine({
      name: 'External Docker MariaDB',
      type: 'mariadb',
      version: '12.3',
      mode: 'external-docker',
      externalContainerName: 'custom-mariadb-lab',
      network: 'proxy',
      internalPort: 3306,
      rootUsername: 'root',
      rootPassword: 'MariaDbPassword!2026'
    });
    assert.strictEqual(maria.mode, 'external-docker');
    assert.strictEqual(maria.type, 'mariadb');

    // 3. Register external-remote PostgreSQL
    const postgres = await EngineRegistry.registerEngine({
      name: 'Remote Postgres 16',
      type: 'postgres',
      version: '16',
      mode: 'external-remote',
      host: '10.0.0.50',
      port: 5432,
      tls: false,
      rootUsername: 'postgres',
      rootPassword: 'PostgresPassword!2026'
    });
    assert.strictEqual(postgres.mode, 'external-remote');
    assert.strictEqual(postgres.type, 'postgres');

    // 4. Test connectivity via API
    const testRes = await app.inject({
      method: 'POST',
      url: `/api/v1/db-engines/${maria.id}/test`,
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(testRes.statusCode, 200);
    assert.strictEqual(testRes.json().result.ok, true);
  });

  it('enforces Hard Rule R2: external engines cannot be stopped, disabled, or managed', async () => {
    const engines = await EngineRegistry.listEngines();
    const externalEngine = engines.find((e) => e.mode === 'external-docker' || e.mode === 'external-remote');
    assert.ok(externalEngine, 'External engine must exist');

    // Attempting to toggle/disable external engine must fail with R2 violation
    const toggleRes = await app.inject({
      method: 'POST',
      url: `/api/v1/db-engines/${externalEngine.id}/toggle`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { enabled: false }
    });

    assert.strictEqual(toggleRes.statusCode, 500);
    assert.ok(toggleRes.json().error.message.includes('Hard Rule R2 Violation'));

    // Meanwhile, toggling internal engine succeeds
    const internalEngine = engines.find((e) => e.mode === 'internal-docker')!;
    const internalToggleRes = await app.inject({
      method: 'POST',
      url: `/api/v1/db-engines/${internalEngine.id}/toggle`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { enabled: false }
    });
    assert.strictEqual(internalToggleRes.statusCode, 200);
    assert.strictEqual(internalToggleRes.json().engine.status, 'disabled');

    // Re-enable internal engine
    await EngineRegistry.toggleEngine(internalEngine.id, true);
  });

  it('creates database + user atomically and stores credentials in vault (FR-DB-03, 04)', async () => {
    const defaultEngine = await EngineRegistry.getDefaultEngine();

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/databases',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        engineId: defaultEngine.id,
        name: 'app_production_db',
        user: {
          username: 'app_user',
          privileges: 'read_write'
        }
      }
    });

    assert.strictEqual(createRes.statusCode, 201);
    const body = createRes.json();
    assert.strictEqual(body.database.name, 'app_production_db');
    assert.strictEqual(body.user.username, 'app_user');
    assert.strictEqual(body.user.privileges, 'read_write');
    assert.ok(body.user.password.length >= 16);

    // Verify password is encrypted in DB and not stored in plaintext
    const dbRow = memoryDb.getTable('db_users').get(body.user.id);
    assert.ok(dbRow.password_secret_ref);
    assert.notStrictEqual(dbRow.password_secret_ref, body.user.password);
    assert.strictEqual(VaultService.decrypt(dbRow.password_secret_ref), body.user.password);
  });

  it('blocks WordPress on PostgreSQL by default (R3 & FR-DB-03)', async () => {
    // 1. Create a WordPress site
    const wpSite = await SiteService.createSite({
      domain: 'wp-pg-test.example.com',
      type: 'wordpress',
      phpVersion: '8.3'
    });

    // 2. Find postgres engine
    const engines = await EngineRegistry.listEngines();
    const pgEngine = engines.find((e) => e.type === 'postgres');
    assert.ok(pgEngine, 'Postgres engine must exist');

    // 3. Attempt to create database on Postgres for WP site without flag
    const blockedRes = await app.inject({
      method: 'POST',
      url: '/api/v1/databases',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        siteId: wpSite.id,
        engineId: pgEngine.id,
        name: 'wp_pg_db',
        user: { username: 'wp_pg_user' }
      }
    });

    assert.strictEqual(blockedRes.statusCode, 500);
    assert.ok(blockedRes.json().error.message.includes('WordPress requires MySQL or MariaDB by default'));

    // 4. With explicit allowPostgresWordPress flag, it is permitted
    const allowedRes = await app.inject({
      method: 'POST',
      url: '/api/v1/databases',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        siteId: wpSite.id,
        engineId: pgEngine.id,
        name: 'wp_pg_db',
        user: { username: 'wp_pg_user' },
        allowPostgresWordPress: true
      }
    });

    assert.strictEqual(allowedRes.statusCode, 201);
    assert.strictEqual(allowedRes.json().database.name, 'wp_pg_db');
  });

  it('manages database users: add user, change password, delete user (FR-DB-12)', async () => {
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/databases',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const targetDb = listRes.json().data[0];

    // 1. Add secondary user
    const addUserRes = await app.inject({
      method: 'POST',
      url: `/api/v1/databases/${targetDb.id}/users`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        username: 'readonly_reporter',
        privileges: 'read_only'
      }
    });
    assert.strictEqual(addUserRes.statusCode, 201);
    const addedUser = addUserRes.json().user;
    assert.strictEqual(addedUser.username, 'readonly_reporter');
    assert.strictEqual(addedUser.privileges, 'read_only');

    // 2. Change user password
    const changePassRes = await app.inject({
      method: 'POST',
      url: `/api/v1/databases/${targetDb.id}/users/${addedUser.id}/reset-password`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { password: 'NewSecurePassword!2026' }
    });
    assert.strictEqual(changePassRes.statusCode, 200);
    assert.strictEqual(changePassRes.json().password, 'NewSecurePassword!2026');

    // 3. Delete user
    const deleteUserRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/databases/${targetDb.id}/users/${addedUser.id}`,
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(deleteUserRes.statusCode, 200);
    assert.strictEqual(deleteUserRes.json().message, 'User removed from database successfully');
  });

  it('generates one-click SSO tokens without passwords in URL (FR-DB-05)', async () => {
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/databases',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const mysqlDb = listRes.json().data.find((d: any) => d.engine?.type === 'mysql');
    const pgDb = listRes.json().data.find((d: any) => d.engine?.type === 'postgres');

    // 1. phpMyAdmin for MySQL
    const pmaRes = await app.inject({
      method: 'POST',
      url: `/api/v1/databases/${mysqlDb.id}/sso`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { userId: mysqlDb.users[0].id, preferredTool: 'phpmyadmin' }
    });
    assert.strictEqual(pmaRes.statusCode, 200);
    const pmaBody = pmaRes.json().sso;
    assert.strictEqual(pmaBody.tool, 'phpmyadmin');
    assert.ok(pmaBody.ssoUrl.includes('/sso/phpmyadmin?token='));
    // Ensure no password in URL
    assert.strictEqual(pmaBody.ssoUrl.includes('password'), false);

    // 2. pgAdmin for PostgreSQL
    const pgRes = await app.inject({
      method: 'POST',
      url: `/api/v1/databases/${pgDb.id}/sso`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { userId: pgDb.users[0].id, preferredTool: 'pgadmin' }
    });
    assert.strictEqual(pgRes.statusCode, 200);
    assert.strictEqual(pgRes.json().sso.tool, 'pgadmin');

    // 3. Reject phpMyAdmin for PostgreSQL
    const invalidToolRes = await app.inject({
      method: 'POST',
      url: `/api/v1/databases/${pgDb.id}/sso`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { userId: pgDb.users[0].id, preferredTool: 'phpmyadmin' }
    });
    assert.strictEqual(invalidToolRes.statusCode, 500);
    assert.ok(invalidToolRes.json().error.message.includes('phpMyAdmin does not support PostgreSQL'));
  });

  it('exports, imports via background job, and runs nightly backups with retention (FR-DB-06, 07)', async () => {
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/databases',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const targetDb = listRes.json().data[0];

    // 1. Export database to .sql.gz
    const exportRes = await app.inject({
      method: 'POST',
      url: `/api/v1/databases/${targetDb.id}/export`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { gzip: true }
    });
    assert.strictEqual(exportRes.statusCode, 200);
    const exp = exportRes.json().export;
    assert.ok(exp.filePath.endsWith('.sql.gz'));
    assert.strictEqual(fs.existsSync(exp.filePath), true);

    // 2. Import database dump via background job
    const sampleSql = `
      CREATE TABLE IF NOT EXISTS sample_table (id INT PRIMARY KEY, name VARCHAR(50));
      INSERT INTO sample_table (id, name) VALUES (1, 'NexPanel test');
    `;
    const importRes = await app.inject({
      method: 'POST',
      url: `/api/v1/databases/${targetDb.id}/import`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { sql: sampleSql, isGzip: false }
    });
    assert.strictEqual(importRes.statusCode, 200);
    const jobId = importRes.json().jobId;
    assert.ok(jobId);

    // Wait a brief moment for async job execution
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Check job status
    const jobRes = await app.inject({
      method: 'GET',
      url: `/api/v1/jobs/${jobId}`,
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(jobRes.json().job.status, 'done');

    // 3. Run nightly dumps runner with 7-day retention
    const nightlyReport = await DumpService.runNightlyDumps(7);
    assert.ok(nightlyReport.dumpsCreated >= 1);
  });

  it('manages per-site Redis configuration and flush (FR-DB-11)', async () => {
    const site = await SiteService.createSite({
      domain: 'redis-test.example.com',
      type: 'wordpress',
      phpVersion: '8.3'
    });

    // 1. Get initial Redis config
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/sites/${site.id}/redis`,
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(getRes.statusCode, 200);
    assert.strictEqual(getRes.json().config.enabled, false);

    // 2. Enable Redis
    const enableRes = await app.inject({
      method: 'POST',
      url: `/api/v1/sites/${site.id}/redis/toggle`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { enabled: true }
    });
    assert.strictEqual(enableRes.statusCode, 200);
    const conf = enableRes.json().config;
    assert.strictEqual(conf.enabled, true);
    assert.ok(conf.connectionString.startsWith('redis://nexpanel-redis:6379/'));

    // 3. Flush Redis
    const flushRes = await app.inject({
      method: 'POST',
      url: `/api/v1/sites/${site.id}/redis/flush`,
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(flushRes.statusCode, 200);
    assert.ok(flushRes.json().message.includes('flushed successfully'));
  });
});
