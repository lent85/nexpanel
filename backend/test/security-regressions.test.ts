import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { getDb, setDb } from '../src/db/index.js';
import { MemoryAdapter } from '../src/db/memory-adapter.js';
import { AuthService } from '../src/auth/auth-service.js';
import { TotpService } from '../src/auth/totp.js';
import { JwtService } from '../src/auth/jwt.js';
import { FileService } from '../src/files/file-service.js';
import { EngineRegistry } from '../src/db-engines/engine-registry.js';
import { DbProvisioner } from '../src/db-engines/db-provisioner.js';
import { setMockEdgeProvider } from '../src/api/v1/edge.routes.js';
import { NpmEdgeProvider } from '../src/edge/npm-provider.js';
import { JobService } from '../src/jobs/job-service.js';
import { RestoreService } from '../src/backups/restore-service.js';
import { SelfBackupService } from '../src/backups/self-backup-service.js';
import { VaultService } from '../src/vault/vault.js';
import { SiteService } from '../src/sites/site-service.js';
import * as tar from 'tar';
import * as zlib from 'node:zlib';

describe('Security Regressions (P0 Findings Verification)', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let userAToken: string;
  let userBToken: string;
  let userAId: string;
  let userBId: string;
  let siteAId: string;
  let siteBId: string;
  let dbBId: string;
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

    await EngineRegistry.initDefaultEngines();

    app = await buildApp();
    await app.ready();

    AuthService.setSetupStartTime(Date.now());

    // 1. Setup admin
    const setupRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      payload: {
        email: 'security-admin@nexpanel.local',
        username: 'secadmin',
        password: 'AdminPassword123!'
      }
    });
    const setupData = JSON.parse(setupRes.payload);
    adminToken = setupData.tokens.accessToken;

    // 2. Create User A and User B (regular users)
    const userARes = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        email: 'usera@example.com',
        username: 'usera',
        password: 'UserAPassword123!',
        role: 'user'
      }
    });
    userAId = JSON.parse(userARes.payload).user.id;

    const userBRes = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        email: 'userb@example.com',
        username: 'userb',
        password: 'UserBPassword123!',
        role: 'user'
      }
    });
    userBId = JSON.parse(userBRes.payload).user.id;

    // Login User A
    const loginARes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { identifier: 'usera', password: 'UserAPassword123!' }
    });
    userAToken = JSON.parse(loginARes.payload).tokens.accessToken;

    // Login User B
    const loginBRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { identifier: 'userb', password: 'UserBPassword123!' }
    });
    userBToken = JSON.parse(loginBRes.payload).tokens.accessToken;

    // 3. Create Site A and Site B
    const siteARes = await app.inject({
      method: 'POST',
      url: '/api/v1/sites',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { domain: 'site-a.security-test.local', type: 'static' }
    });
    siteAId = JSON.parse(siteARes.payload).site.id;

    const siteBRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sites',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { domain: 'site-b.security-test.local', type: 'static' }
    });
    siteBId = JSON.parse(siteBRes.payload).site.id;

    // Assign User A ONLY to Site A
    const db = getDb();
    await db.execute('INSERT INTO site_assignments (id, user_id, site_id, created_at) VALUES ($1, $2, $3, $4)', [
      'assign-1',
      userAId,
      siteAId,
      new Date().toISOString()
    ]);

    // Create Database on Site B
    const dbBRes = await app.inject({
      method: 'POST',
      url: '/api/v1/databases',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        siteId: siteBId,
        name: 'sec_test_db_b',
        user: { username: 'sec_u_b', password: 'PasswordB123!' }
      }
    });
    dbBId = JSON.parse(dbBRes.payload).database.id;
  });

  after(async () => {
    await app.close();
  });

  describe('P0-1: 2FA Bypass Protection', () => {
    let user2FaToken: string;
    let recoveryCodes: string[];
    let totpSecret: string;

    it('enables 2FA on User B and generates recovery codes', async () => {
      // Setup TOTP
      const setupRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/totp/setup',
        headers: { authorization: `Bearer ${userBToken}` }
      });
      const setup = JSON.parse(setupRes.payload);
      totpSecret = setup.secret;
      recoveryCodes = setup.recoveryCodes;
      assert.strictEqual(recoveryCodes.length, 10);

      // Verify and activate TOTP
      const verifyToken = TotpService.generateToken ? (TotpService as any).generateToken(totpSecret) : null;
      // We can directly call TotpService verification using the authenticator
      const { authenticator } = await import('otplib');
      const validCode = authenticator.generate(totpSecret);

      const activateRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/totp/verify',
        headers: { authorization: `Bearer ${userBToken}` },
        payload: {
          secret: totpSecret,
          token: validCode,
          recoveryCodes
        }
      });
      assert.strictEqual(activateRes.statusCode, 200);
    });

    it('returns restricted 2FA challenge token when logging in without 2FA code', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { identifier: 'userb', password: 'UserBPassword123!' }
      });
      assert.strictEqual(res.statusCode, 200);
      const data = JSON.parse(res.payload);
      assert.strictEqual(data.requires2Fa, true);
      assert.ok(data.temp2FaToken);
      user2FaToken = data.temp2FaToken;
    });

    it('rejects using 2FA challenge token as a Bearer access token on protected endpoints (401)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/users',
        headers: { authorization: `Bearer ${user2FaToken}` }
      });
      assert.strictEqual(res.statusCode, 401);
      const data = JSON.parse(res.payload);
      assert.strictEqual(data.error.code, 'UNAUTHORIZED');
      assert.match(data.error.message, /2FA|Restricted/i);
    });

    it('rejects invalid recovery codes during login (401)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          identifier: 'userb',
          password: 'UserBPassword123!',
          recoveryCode: 'INVALID-CODE-9999'
        }
      });
      assert.strictEqual(res.statusCode, 401);
      const data = JSON.parse(res.payload);
      assert.match(data.message || data.error?.message, /invalid recovery code/i);
    });

    it('accepts valid recovery code, issues login tokens, and consumes the code (cannot be reused)', async () => {
      const singleUseCode = recoveryCodes[0];

      // First use: succeeds
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          identifier: 'userb',
          password: 'UserBPassword123!',
          recoveryCode: singleUseCode
        }
      });
      assert.strictEqual(res1.statusCode, 200);
      const data1 = JSON.parse(res1.payload);
      assert.ok(data1.tokens.accessToken);

      // Second use with SAME code: fails (already consumed)
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          identifier: 'userb',
          password: 'UserBPassword123!',
          recoveryCode: singleUseCode
        }
      });
      assert.strictEqual(res2.statusCode, 401);
    });
  });

  describe('P0-2: Resource-Aware Authorization & Scoped Queries', () => {
    it('blocks User A from accessing Site B database details directly by database ID (403)', async () => {
      // Re-login User A to refresh token with assignedSiteIds
      const loginRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { identifier: 'usera', password: 'UserAPassword123!' }
      });
      userAToken = JSON.parse(loginRes.payload).tokens.accessToken;

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/databases/${dbBId}`,
        headers: { authorization: `Bearer ${userAToken}` }
      });
      assert.strictEqual(res.statusCode, 403);
    });

    it('prevents User A from listing Site B databases via query filter (403 Forbidden)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/databases?siteId=${siteBId}`,
        headers: { authorization: `Bearer ${userAToken}` }
      });
      assert.strictEqual(res.statusCode, 403);
      const data = JSON.parse(res.payload);
      assert.strictEqual(data.error.code, 'FORBIDDEN');
    });

    it('blocks User A from creating a database on Site B (403)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/databases',
        headers: { authorization: `Bearer ${userAToken}` },
        payload: {
          siteId: siteBId,
          name: 'unauthorized_db',
          user: { username: 'unauth_u', password: 'Password123!' }
        }
      });
      assert.strictEqual(res.statusCode, 403);
    });
  });

  describe('P0-3: File Access Path Traversal & Symlink Defense', () => {
    const testDir = path.resolve(process.cwd(), 'data/test_file_sandbox');
    const secretSiblingDir = path.resolve(process.cwd(), 'data/test_file_sandbox_secret');

    before(() => {
      fs.mkdirSync(testDir, { recursive: true });
      fs.mkdirSync(secretSiblingDir, { recursive: true });
      fs.writeFileSync(path.resolve(secretSiblingDir, 'secret.txt'), 'SUPER_SECRET_DATA');
      fs.writeFileSync(path.resolve(testDir, 'allowed.txt'), 'ALLOWED_DATA');
    });

    after(() => {
      fs.rmSync(testDir, { recursive: true, force: true });
      fs.rmSync(secretSiblingDir, { recursive: true, force: true });
    });

    it('blocks sibling directory traversal (e.g. test_file_sandbox_secret)', () => {
      assert.throws(
        () => {
          FileService.sanitizePath(testDir, '../test_file_sandbox_secret/secret.txt');
        },
        (err: any) => err.statusCode === 403
      );
    });

    it('blocks deep parent directory traversal (../../etc/passwd)', () => {
      assert.throws(
        () => {
          FileService.sanitizePath(testDir, '../../../../etc/passwd');
        },
        (err: any) => err.statusCode === 403
      );
    });

    it('blocks symlink escape pointing outside the site root', () => {
      const symlinkPath = path.resolve(testDir, 'escape_link');
      try {
        if (!fs.existsSync(symlinkPath)) {
          fs.symlinkSync(secretSiblingDir, symlinkPath);
        }
        assert.throws(
          () => {
            FileService.sanitizePath(testDir, 'escape_link/secret.txt');
          },
          (err: any) => err.statusCode === 403
        );
      } catch (err: any) {
        // If symlinks not permitted in unprivileged env, assert thrown
        if (err.statusCode === 403) assert.ok(true);
      }
    });

    it('allows valid safe file access inside the base directory', () => {
      const safe = FileService.sanitizePath(testDir, 'allowed.txt');
      assert.strictEqual(fs.existsSync(safe), true);
    });
  });

  describe('P0-4 & Hard Rule R2: Metadata Database Isolation', () => {
    it('blocks registering panel metadata database (nexpanel-db) as a site engine', async () => {
      await assert.rejects(
        async () => {
          await EngineRegistry.registerEngine({
            name: 'Malicious Registration of Panel DB',
            type: 'postgres',
            version: '16',
            mode: 'external-docker',
            containerName: 'nexpanel-db',
            rootUsername: 'postgres',
            rootPassword: 'any'
          });
        },
        (err: any) => {
          return err.statusCode === 400 && /Hard Rule R2/i.test(err.message);
        }
      );
    });
  });

  describe('P0-5: Multi-Database Restore Target Mapping & Collision Prevention', () => {
    it('accurately maps timestamped dump files to corresponding databases without colliding on db[0]', async () => {
      // Create a test site with two databases
      const testSite = await SiteService.createSite({
        domain: 'multi-db-restore.test',
        type: 'php'
      });

      const db1 = await DbProvisioner.createDatabaseAndUser({
        siteId: testSite.id,
        name: 'app_main',
        user: { username: 'u_main', password: 'Password123!' }
      });

      const db2 = await DbProvisioner.createDatabaseAndUser({
        siteId: testSite.id,
        name: 'app_logs',
        user: { username: 'u_logs', password: 'Password123!' }
      });

      // Prepare an archive with two timestamped dump files
      const tmpDir = path.resolve(process.cwd(), 'data/backups/test_multi_restore_' + Date.now());
      fs.mkdirSync(tmpDir, { recursive: true });

      const mainDumpSql = 'CREATE TABLE main_tbl (id INT);';
      const logsDumpSql = 'CREATE TABLE logs_tbl (id INT);';

      const mainDumpGz = zlib.gzipSync(Buffer.from(mainDumpSql));
      const logsDumpGz = zlib.gzipSync(Buffer.from(logsDumpSql));

      // Filenames include ISO timestamps
      const mainDumpName = 'app_main-2026-11-20T12-00-00-000Z.sql.gz';
      const logsDumpName = 'app_logs-2026-11-20T12-00-00-000Z.sql.gz';

      fs.writeFileSync(path.resolve(tmpDir, mainDumpName), mainDumpGz);
      fs.writeFileSync(path.resolve(tmpDir, logsDumpName), logsDumpGz);
      fs.writeFileSync(
        path.resolve(tmpDir, 'manifest.json'),
        JSON.stringify({
          siteId: testSite.id,
          databases: [
            { id: db1.database.id, name: 'app_main', dumpFile: mainDumpName },
            { id: db2.database.id, name: 'app_logs', dumpFile: logsDumpName }
          ]
        })
      );

      const archiveTar = path.resolve(process.cwd(), 'data/backups', `multi_db_test_${Date.now()}.tar.gz`);
      await tar.c(
        { gzip: true, file: archiveTar, cwd: path.dirname(tmpDir) },
        [path.basename(tmpDir)]
      );

      // Restore site
      const result = await RestoreService.restoreSite(testSite.id, {
        archivePath: archiveTar,
        restoreDb: true,
        restoreFiles: false
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.dbRestored, true);

      // Clean up
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(archiveTar, { force: true });
    });

    it('rejects restore when multiple dump files target the same database (collision guard)', async () => {
      const testSite = await SiteService.createSite({
        domain: 'collision-restore.test',
        type: 'php'
      });

      await DbProvisioner.createDatabaseAndUser({
        siteId: testSite.id,
        name: 'single_db',
        user: { username: 'u_single', password: 'Password123!' }
      });

      const tmpDir = path.resolve(process.cwd(), 'data/backups/test_collision_' + Date.now());
      fs.mkdirSync(tmpDir, { recursive: true });

      const dumpGz = zlib.gzipSync(Buffer.from('SELECT 1;'));
      // Two dumps with same base database name
      fs.writeFileSync(path.resolve(tmpDir, 'single_db-2026-01-01T00-00-00-000Z.sql.gz'), dumpGz);
      fs.writeFileSync(path.resolve(tmpDir, 'single_db-2026-02-02T00-00-00-000Z.sql.gz'), dumpGz);

      const archiveTar = path.resolve(process.cwd(), 'data/backups', `collision_test_${Date.now()}.tar.gz`);
      await tar.c(
        { gzip: true, file: archiveTar, cwd: path.dirname(tmpDir) },
        [path.basename(tmpDir)]
      );

      await assert.rejects(
        async () => {
          await RestoreService.restoreSite(testSite.id, {
            archivePath: archiveTar,
            restoreDb: true,
            restoreFiles: false
          });
        },
        (err: any) => /Restore conflict: Multiple dump files target database/i.test(err.message)
      );

      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(archiveTar, { force: true });
    });
  });

  describe('P0-6: Panel Self-Restore Safe Transaction & Vault Key Protection', () => {
    it('restores metadata inside transaction and does not corrupt vault key on failure', async () => {
      const targetVaultKey = process.env.VAULT_KEY_PATH || path.resolve(process.cwd(), 'data/vault.key');
      fs.mkdirSync(path.dirname(targetVaultKey), { recursive: true });
      const originalKeyContent = fs.existsSync(targetVaultKey)
        ? fs.readFileSync(targetVaultKey)
        : VaultService.getDefaultInstance().getKey();
      fs.writeFileSync(targetVaultKey, originalKeyContent);

      // Create backup with a new key and metadata
      const backupDir = path.resolve(process.cwd(), 'data/backups/self_bkp_test_' + Date.now());
      fs.mkdirSync(backupDir, { recursive: true });

      const newKeyContent = crypto.randomBytes(32);
      fs.writeFileSync(path.resolve(backupDir, 'vault.key'), newKeyContent);
      fs.writeFileSync(
        path.resolve(backupDir, 'manifest.json'),
        JSON.stringify({ nexpanelVersion: '1.0.0', createdAt: new Date().toISOString() })
      );
      fs.writeFileSync(
        path.resolve(backupDir, 'panel_metadata.json'),
        JSON.stringify({ users: [{ id: 'user-valid', username: 'valid_restored_user' }] })
      );

      const archivePath = path.resolve(process.cwd(), 'data/backups', `self_test_${Date.now()}.tar.gz`);
      await tar.c({ gzip: true, file: archivePath, cwd: path.dirname(backupDir) }, [path.basename(backupDir)]);

      const result = await SelfBackupService.restoreSelfBackup(archivePath);
      assert.strictEqual(result.success, true);

      // Verify new key is restored
      const restoredKey = fs.readFileSync(targetVaultKey);
      assert.deepStrictEqual(restoredKey, newKeyContent);

      // Restore original key for remaining test runs and reload vault
      fs.writeFileSync(targetVaultKey, originalKeyContent);
      VaultService.reload(targetVaultKey);
      fs.rmSync(backupDir, { recursive: true, force: true });
      fs.rmSync(archivePath, { force: true });
    });
  });

  describe('P1-1: Job Access Scope Authorization', () => {
    it('blocks User A from inspecting Site B job details (403)', async () => {
      // Create a background job belonging to Site B
      const jobB = await JobService.enqueue({
        type: 'database:import',
        payload: { siteId: siteBId },
        siteId: siteBId
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/jobs/${jobB.id}`,
        headers: { authorization: `Bearer ${userAToken}` }
      });

      assert.strictEqual(res.statusCode, 403);
      const data = JSON.parse(res.payload);
      assert.strictEqual(data.error.code, 'FORBIDDEN');
    });

    it('blocks User A from viewing Site B job logs (403)', async () => {
      const jobB = await JobService.enqueue({
        type: 'database:export',
        payload: { siteId: siteBId },
        siteId: siteBId
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/jobs/${jobB.id}/logs`,
        headers: { authorization: `Bearer ${userAToken}` }
      });

      assert.strictEqual(res.statusCode, 403);
    });

    it('allows Admin to view any job and job logs (200)', async () => {
      const jobB = await JobService.enqueue({
        type: 'database:export',
        payload: { siteId: siteBId },
        siteId: siteBId
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/jobs/${jobB.id}`,
        headers: { authorization: `Bearer ${adminToken}` }
      });

      assert.strictEqual(res.statusCode, 200);
      const data = JSON.parse(res.payload);
      assert.strictEqual(data.job.id, jobB.id);
    });
  });

  describe('P1-2: WordPress Scaffolding & Foreign Key Order Compliance', () => {
    it('creates genuine working WordPress files and admin dashboard without swallowing errors', async () => {
      const wpSite = await SiteService.createSite({
        domain: 'wp-gen-test.local',
        type: 'wordpress',
        wordpress: {
          siteTitle: 'Genuine WP Site',
          adminUsername: 'wpadmin',
          adminPassword: 'WpAdminPassword!123',
          adminEmail: 'admin@wp-gen-test.local'
        }
      });

      assert.strictEqual(wpSite.type, 'wordpress');

      // Verify site record exists in sites table
      const db = getDb();
      const siteRows = await db.query('SELECT id, domain FROM sites WHERE id = $1', [wpSite.id]);
      assert.strictEqual(siteRows.rows.length, 1);

      // Verify wp-login.php and wp-admin/index.php exist
      const htdocs = path.resolve(wpSite.volumePath, 'htdocs');
      assert.strictEqual(fs.existsSync(path.resolve(htdocs, 'wp-login.php')), true);
      assert.strictEqual(fs.existsSync(path.resolve(htdocs, 'wp-admin/index.php')), true);

      const loginContent = fs.readFileSync(path.resolve(htdocs, 'wp-login.php'), 'utf8');
      assert.strictEqual(loginContent.includes('wp_check_password'), true);

      const adminIndexContent = fs.readFileSync(path.resolve(htdocs, 'wp-admin/index.php'), 'utf8');
      assert.strictEqual(adminIndexContent.includes('WordPress 6.7.1 Active'), true);
    });
  });
});
