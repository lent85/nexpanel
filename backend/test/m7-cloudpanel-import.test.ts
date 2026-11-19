import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { buildApp } from '../src/app.js';
import { getDb, setDb } from '../src/db/index.js';
import { MemoryAdapter } from '../src/db/memory-adapter.js';
import { AuthService } from '../src/auth/auth-service.js';
import { EngineRegistry } from '../src/db-engines/engine-registry.js';
import { TarInspector } from '../src/importer/tar-inspector.js';
import { DryRunSimulator } from '../src/importer/dry-run-simulator.js';
import { ImportExecutor } from '../src/importer/import-executor.js';
import { RollbackService } from '../src/importer/rollback-service.js';
import { ImportJobManager } from '../src/importer/import-job-manager.js';
import { LiveSshService } from '../src/importer/live-ssh-service.js';

describe('Milestone 7: CloudPanel Import & Migration (FR-IMP-01 to 04, R3)', () => {
  let app: any;
  let adminToken: string;
  let db: MemoryAdapter;
  let internalMysqlEngineId: string;
  let postgresEngineId: string;

  const fixturesDir = path.resolve(process.cwd(), '../fixtures/cloudpanel');
  const backupTarPath = path.resolve(fixturesDir, 'backup.tar');
  const brokenTarPath = path.resolve(fixturesDir, 'broken.tar');
  const localFilesPath = path.resolve(fixturesDir, 'local-files.tar.gz');
  const localDbPath = path.resolve(fixturesDir, 'local-db.sql.gz');

  before(async () => {
    db = new MemoryAdapter();
    setDb(db);
    AuthService.setSetupStartTime(Date.now());

    app = await buildApp({ logger: false });
    await app.ready();

    // 1. Initial admin creation
    const setupRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      payload: {
        email: 'admin@nexpanel.local',
        username: 'admin',
        password: 'AdminPassword!2026',
        timezone: 'Asia/Bangkok'
      }
    });
    assert.strictEqual(setupRes.statusCode, 200);
    adminToken = setupRes.json().tokens.accessToken;

    // 2. Register internal MySQL and PostgreSQL engines
    const mysqlEng = await EngineRegistry.registerEngine({
      name: 'internal-mysql',
      type: 'mysql',
      version: '8.4',
      mode: 'internal-docker',
      host: 'nexpanel-mysql',
      port: 3306,
      rootUsername: 'root',
      rootPassword: 'RootPassword!2026',
      isDefault: true
    });
    internalMysqlEngineId = mysqlEng.id;

    const pgEng = await EngineRegistry.registerEngine({
      name: 'external-postgres',
      type: 'postgres',
      version: '16',
      mode: 'external-docker',
      host: 'external-postgres',
      port: 5432,
      rootUsername: 'postgres',
      rootPassword: 'PgPassword!2026'
    });
    postgresEngineId = pgEng.id;
  });

  after(async () => {
    await app.close();
  });

  it('FR-IMP-01A & FR-IMP-02: Source A (backup.tar) detection creates faithful manifest', async () => {
    const manifest = await TarInspector.inspect({
      sourceType: 'backup_tar',
      filePath: backupTarPath
    });

    assert.strictEqual(manifest.manifestVersion, '1.0');
    assert.strictEqual(manifest.source.type, 'backup_tar');
    assert.strictEqual(manifest.source.fileName, 'backup.tar');
    assert.strictEqual(manifest.site.domain, 'example.com');
    assert.strictEqual(manifest.site.type, 'wordpress');
    assert.strictEqual(manifest.site.typeConfidence, 'high');
    assert.strictEqual(manifest.site.phpVersionDetected, '8.2');
    assert.strictEqual(manifest.databases.length > 0, true);
    assert.strictEqual(manifest.databases[0].name, 'wp_example');
    assert.strictEqual(manifest.databases[0].userDetected, 'wp_example_user');

    // Cron warning (not in backup.tar)
    assert.strictEqual(manifest.cron.found, false);
    assert.strictEqual(manifest.cron.warning?.includes('Cron jobs are NOT in a backup.tar'), true);

    // SSL note
    assert.strictEqual(manifest.ssl.found, false);
    assert.strictEqual(manifest.ssl.note?.includes("Let's Encrypt certs are not in the backup"), true);

    // Excludes
    assert.deepStrictEqual(manifest.excludesInBackup, ['.ssh', 'logs', 'tmp']);
  });

  it('Hard Rule R3: Dry-run simulation blocks WordPress on PostgreSQL', async () => {
    const manifest = await TarInspector.inspect({
      sourceType: 'backup_tar',
      filePath: backupTarPath
    });

    const result = await DryRunSimulator.simulate(manifest, {
      domain: 'example.com',
      phpVersion: '8.2',
      dbEngineId: postgresEngineId, // Attempting PostgreSQL for WordPress!
      dbName: 'wp_example',
      dbUser: 'wp_user',
      sslMode: 'letsencrypt-http01-after-dns-cutover'
    });

    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.errors.some((e) => e.includes('Hard Rule Violation')), true);
    assert.strictEqual(result.checks.some((c) => c.name === 'hard_rule_r3_wordpress_postgres' && c.status === 'error'), true);
  });

  it('FR-IMP-02 & Hard Rule R1: Dry-run with MySQL passes and plans forward_host without localhost', async () => {
    const manifest = await TarInspector.inspect({
      sourceType: 'backup_tar',
      filePath: backupTarPath
    });

    const result = await DryRunSimulator.simulate(manifest, {
      domain: 'example.com',
      phpVersion: '8.2',
      dbEngineId: internalMysqlEngineId,
      dbName: 'wp_example',
      dbUser: 'wp_user',
      sslMode: 'letsencrypt-http01-after-dns-cutover'
    });

    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.errors.length, 0);
    assert.strictEqual(result.actions.length >= 7, true);

    // Verify Rule R1: forward host must never be localhost
    const npmAction = result.actions.find((a) => a.step === 'npm_proxy_host');
    assert.strictEqual(Boolean(npmAction), true);
    assert.strictEqual(npmAction?.description.includes('Rule R1: never localhost'), true);
  });

  it('FR-IMP-03: Full execution of backup.tar import creates site, DB, rewrites wp-config.php and passes verification', async () => {
    // 1. Initiate via API
    const initRes = await app.inject({
      method: 'POST',
      url: '/api/v1/imports/cloudpanel',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        sourceType: 'backup_tar',
        filePath: backupTarPath
      }
    });
    if (initRes.statusCode !== 201) {
      console.log('INIT ERROR:', initRes.statusCode, initRes.json());
    }
    assert.strictEqual(initRes.statusCode, 201);
    const { job, manifest } = initRes.json();
    assert.strictEqual(job.status, 'detected');

    // 2. Set mapping
    const mapRes = await app.inject({
      method: 'POST',
      url: `/api/v1/imports/${job.id}/mapping`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        domain: 'example.com',
        phpVersion: '8.2',
        dbEngineId: internalMysqlEngineId,
        dbName: 'wp_example',
        dbUser: 'wp_user',
        sslMode: 'letsencrypt-http01-after-dns-cutover'
      }
    });
    assert.strictEqual(mapRes.statusCode, 200);

    // 3. Dry-run via API
    const dryRes = await app.inject({
      method: 'POST',
      url: `/api/v1/imports/${job.id}/dry-run`,
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(dryRes.statusCode, 200);
    assert.strictEqual(dryRes.json().result.valid, true);

    // 4. Run Import
    const runRes = await app.inject({
      method: 'POST',
      url: `/api/v1/imports/${job.id}/run`,
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(runRes.statusCode, 200);
    const { report } = runRes.json();

    assert.strictEqual(report.status, 'done');
    assert.strictEqual(report.domain, 'example.com');
    assert.strictEqual(report.verification.siteDirectoryExists, true);
    assert.strictEqual(report.verification.configRewritten, true);
    assert.strictEqual(report.verification.wpLoginFound, true);

    // Verify wp-config.php and wp-config.php.bak on disk
    const htdocsPath = path.resolve(report.site.volumePath, 'htdocs');
    assert.strictEqual(fs.existsSync(path.resolve(htdocsPath, 'wp-config.php')), true);
    assert.strictEqual(fs.existsSync(path.resolve(htdocsPath, 'wp-config.php.bak')), true);

    const rewrittenConfig = fs.readFileSync(path.resolve(htdocsPath, 'wp-config.php'), 'utf8');
    assert.strictEqual(rewrittenConfig.includes("define('DB_NAME', 'wp_example');"), true);
    assert.strictEqual(rewrittenConfig.includes("define('DB_USER', 'wp_user');"), true);
    assert.strictEqual(rewrittenConfig.includes("define('DB_HOST', 'nexpanel-mysql');"), true);
  });

  it('FR-IMP-04: Idempotency guard prevents duplicate import and DB duplication', async () => {
    // Attempt second import with identical checksum and domain
    const secondJob = await ImportJobManager.createJob({
      sourceType: 'backup_tar',
      sourceRef: backupTarPath
    });

    const report = await ImportExecutor.execute({
      jobId: secondJob.id
    });

    assert.strictEqual(report.status, 'done');
    assert.strictEqual(report.warnings.some((w) => w.includes('already imported, no duplicates')), true);

    // Verify databases table didn't duplicate
    const dbs = await db.query("SELECT * FROM databases WHERE name = 'wp_example'");
    assert.strictEqual(dbs.rows.length, 1);
  });

  it('FR-IMP-04: 1-Click Rollback purges imported site and restores clean host state', async () => {
    const jobs = await ImportJobManager.listJobs();
    const importedJob = jobs.find((j) => j.status === 'done' && j.targetSiteId);
    assert.strictEqual(Boolean(importedJob), true);

    const rollbackRes = await app.inject({
      method: 'POST',
      url: `/api/v1/imports/${importedJob!.id}/rollback`,
      headers: { authorization: `Bearer ${adminToken}` }
    });

    assert.strictEqual(rollbackRes.statusCode, 200);
    assert.strictEqual(rollbackRes.json().success, true);

    // Verify job status updated to rolled_back
    const updatedJob = await ImportJobManager.getJobById(importedJob!.id);
    assert.strictEqual(updatedJob?.status, 'rolled_back');

    // Verify site was purged
    const sitesRes = await db.query('SELECT * FROM sites WHERE id = $1', [importedJob!.targetSiteId]);
    assert.strictEqual(sitesRes.rows.length, 0);

    // Verify database was purged
    const dbsRes = await db.query('SELECT * FROM databases WHERE site_id = $1', [importedJob!.targetSiteId]);
    assert.strictEqual(dbsRes.rows.length, 0);
  });

  it('NFR-COMP-04: Fails fast on corrupted / truncated broken.tar', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/imports/cloudpanel',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        sourceType: 'backup_tar',
        filePath: brokenTarPath
      }
    });

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.json().error.includes('Detection failed'), true);
  });

  it('FR-IMP-01B: Source B (local-files.tar.gz + local-db.sql.gz pair) imports correctly', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/imports/cloudpanel',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        sourceType: 'local_tar_gz',
        filePath: localFilesPath,
        dbDumpFilePath: localDbPath
      }
    });

    assert.strictEqual(res.statusCode, 201);
    const { job, manifest } = res.json();
    assert.strictEqual(manifest.source.type, 'local_tar_gz');
    assert.strictEqual(manifest.databases.length, 1);

    // Execute import
    const report = await ImportExecutor.execute({
      jobId: job.id
    });

    assert.strictEqual(report.status, 'done');
    assert.strictEqual(report.verification.siteDirectoryExists, true);
    assert.strictEqual(report.verification.databaseReachable, true);
  });

  it('FR-IMP-01C: Source C (Live CloudPanel server via SSH) detects cron and imports', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/imports/cloudpanel',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        sourceType: 'live_ssh',
        ssh: {
          host: 'cloudpanel.example.com',
          port: 22,
          username: 'examplecom',
          password: 'DisposableOneTimePassword',
          domain: 'live.example.com'
        }
      }
    });

    assert.strictEqual(res.statusCode, 201);
    const { job, manifest } = res.json();

    assert.strictEqual(manifest.source.type, 'live_ssh');
    assert.strictEqual(manifest.site.domain, 'live.example.com');

    // Live SSH detects real cron jobs from crontab / etc/cron.d/clp!
    assert.strictEqual(manifest.cron.found, true);
    assert.strictEqual(manifest.cron.jobs?.length! >= 1, true);
    assert.strictEqual(manifest.cron.jobs?.[0].schedule, '*/15 * * * *');

    // Password must NOT be stored
    assert.strictEqual((job as any).password, undefined);
    assert.strictEqual(job.manifestJson?.source?.type, 'live_ssh');

    // Execute live SSH import
    const report = await ImportExecutor.execute({
      jobId: job.id
    });

    assert.strictEqual(report.status, 'done');
    assert.strictEqual(report.domain, 'live.example.com');
  });
});
