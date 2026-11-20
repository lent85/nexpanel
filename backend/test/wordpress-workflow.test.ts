import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { setDb, getDb } from '../src/db/index.js';
import { MemoryAdapter } from '../src/db/memory-adapter.js';
import { EngineRegistry } from '../src/db-engines/engine-registry.js';
import { AuthService } from '../src/auth/auth-service.js';
import { setMockEdgeProvider } from '../src/api/v1/edge.routes.js';
import { NpmEdgeProvider } from '../src/edge/npm-provider.js';
import { BackupService } from '../src/backups/backup-service.js';
import { RestoreService } from '../src/backups/restore-service.js';
import { SiteService } from '../src/sites/site-service.js';

describe('WordPress Complete Lifecycle & Verification (Workflow #2)', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let memoryDb: MemoryAdapter;
  let wpSiteId: string;
  let wpDomain = 'wp-production.example.com';
  let snapshotArchivePath: string;

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

    await EngineRegistry.initDefaultEngines();

    app = await buildApp();
    await app.ready();

    AuthService.setSetupStartTime(Date.now());
    const setupRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      payload: {
        username: 'admin',
        email: 'admin@wp-test.local',
        password: 'AdminPassword123!'
      }
    });
    adminToken = JSON.parse(setupRes.payload).tokens.accessToken;
  });

  after(async () => {
    await app.close();
  });

  it('provisions a genuine WordPress site with unique UID, database, and real core runtime files', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sites',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        domain: wpDomain,
        type: 'wordpress',
        phpVersion: '8.3',
        wordpress: {
          siteTitle: 'Production WordPress Blog',
          adminUsername: 'wpadmin',
          adminPassword: 'StrongWpPassword!2026',
          adminEmail: 'wpadmin@example.com'
        }
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const data = JSON.parse(res.payload);
    wpSiteId = data.site.id;
    assert.strictEqual(data.site.domain, wpDomain);
    assert.strictEqual(data.site.type, 'wordpress');
    assert.ok(data.site.siteUserUid >= 1001, 'Allocated unique UID >= 1001');

    // 1. Verify filesystem layout and genuine WordPress files
    const slug = SiteService.slugifyDomain(wpDomain);
    const paths = SiteService.getSitePaths(slug);

    assert.strictEqual(fs.existsSync(path.resolve(paths.htdocs, 'wp-config.php')), true);
    assert.strictEqual(fs.existsSync(path.resolve(paths.htdocs, 'wp-login.php')), true);
    assert.strictEqual(fs.existsSync(path.resolve(paths.htdocs, 'wp-blog-header.php')), true);
    assert.strictEqual(fs.existsSync(path.resolve(paths.htdocs, 'wp-settings.php')), true);
    assert.strictEqual(fs.existsSync(path.resolve(paths.htdocs, 'wp-load.php')), true);
    assert.strictEqual(fs.existsSync(path.resolve(paths.htdocs, 'wp-includes/version.php')), true);

    const versionContent = fs.readFileSync(path.resolve(paths.htdocs, 'wp-includes/version.php'), 'utf8');
    assert.match(versionContent, /\$wp_version\s*=\s*'6\.7\.1'/);

    const wpConfig = fs.readFileSync(path.resolve(paths.htdocs, 'wp-config.php'), 'utf8');
    assert.match(wpConfig, /define\(\s*'DB_NAME'/);
    assert.match(wpConfig, /define\(\s*'AUTH_KEY'/);
  });

  it('backs up the WordPress site including real files and database dump', async () => {
    const backupRes = await BackupService.createSiteBackup(
      wpSiteId,
      {
        includeFiles: true,
        includeDb: true
      }
    );

    assert.ok(backupRes.snapshotId);
    assert.strictEqual(fs.existsSync(backupRes.archivePath), true);
    assert.ok(backupRes.sizeBytes > 0);
    snapshotArchivePath = backupRes.archivePath;
  });

  it('restores the WordPress site and database atomically with pre-restore safety snapshot', async () => {
    const restoreRes = await RestoreService.restoreSite({
      siteId: wpSiteId,
      snapshotPathOrId: snapshotArchivePath,
      restoreFiles: true,
      restoreDb: true
    });

    assert.strictEqual(restoreRes.success, true);
    assert.strictEqual(restoreRes.filesRestored, true);
    assert.strictEqual(restoreRes.dbRestored, true);
    assert.ok(restoreRes.preRestoreSnapshotId, 'Pre-restore safety snapshot created');
  });

  it('soft-deletes site with domain confirmation and restores from trash lifecycle', async () => {
    // 1. Delete site (trash)
    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/sites/${wpSiteId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { confirmDomain: wpDomain }
    });
    assert.strictEqual(delRes.statusCode, 200);

    // Verify site is in trash (GET returns 404 because deleted_at is set)
    const getRes1 = await app.inject({
      method: 'GET',
      url: `/api/v1/sites/${wpSiteId}`,
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(getRes1.statusCode, 404);

    // 2. Restore site from trash
    const restoreTrashRes = await app.inject({
      method: 'POST',
      url: `/api/v1/sites/${wpSiteId}/restore`,
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(restoreTrashRes.statusCode, 200);

    // Verify site is live again
    const getRes2 = await app.inject({
      method: 'GET',
      url: `/api/v1/sites/${wpSiteId}`,
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(getRes2.statusCode, 200);
    assert.strictEqual(JSON.parse(getRes2.payload).site.status, 'live');
  });
});
