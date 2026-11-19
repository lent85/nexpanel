import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { buildApp } from '../../backend/src/app.js';
import { setDb } from '../../backend/src/db/index.js';
import { MemoryAdapter } from '../../backend/src/db/memory-adapter.js';
import { setMockEdgeProvider } from '../../backend/src/api/v1/edge.routes.js';
import { NpmEdgeProvider } from '../../backend/src/edge/npm-provider.js';
import { EngineRegistry } from '../../backend/src/db-engines/engine-registry.js';

const execFileAsync = promisify(execFile);

describe('nxctl CLI', () => {
  let app: any;
  let serverPort: number;
  const tsxBin = path.resolve(process.cwd(), 'node_modules/.bin/tsx.cmd');
  const nxctlScript = path.resolve(process.cwd(), 'src/bin/nxctl.ts');

  before(async () => {
    const memoryDb = new MemoryAdapter();
    setDb(memoryDb);

    const mockProvider = {
      kind: 'npm' as const,
      verifyConnection: async () => ({ ok: true, version: '2.16.0' }),
      createHost: async (input: any) => ({ edgeId: 101 }),
      updateHost: async () => {},
      deleteHost: async () => {},
      setHostEnabled: async () => {},
      requestCertificate: async () => ({ edgeCertId: 201 }),
      uploadCertificate: async () => ({ edgeCertId: 202 }),
      listCertificates: async () => [],
      createAccessList: async () => ({ edgeId: 301 }),
      listHosts: async () => []
    } as unknown as NpmEdgeProvider;
    setMockEdgeProvider(mockProvider);

    await EngineRegistry.initDefaultEngines();

    app = await buildApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    serverPort = app.server.address().port;
  });

  after(async () => {
    if (app) {
      await app.close();
    }
  });

  async function runNxctl(args: string[]): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync(
      process.execPath,
      ['--import', 'tsx', nxctlScript, '--api-url', `http://127.0.0.1:${serverPort}`, ...args],
      { cwd: process.cwd() }
    );
  }

  it('prints help message with --help', async () => {
    const { stdout } = await runNxctl(['--help']);
    assert.strictEqual(stdout.includes('nxctl'), true);
    assert.strictEqual(stdout.includes('NexPanel CLI'), true);
  });

  it('executes health check with --json', async () => {
    const { stdout } = await runNxctl(['health', '--json']);
    const parsed = JSON.parse(stdout);
    assert.strictEqual(parsed.live.status, 'ok');
    assert.strictEqual(parsed.ready.status, 'ready');
  });

  it('provisions first administrator via user:add', async () => {
    const { stdout } = await runNxctl([
      'user:add',
      '--username', 'admin',
      '--email', 'admin@example.com',
      '--password', 'AdminPassword!2026',
      '--json'
    ]);
    const parsed = JSON.parse(stdout);
    assert.strictEqual(parsed.success, true);
    assert.strictEqual(parsed.user.username, 'admin');
  });

  it('lists users via user:list --json', async () => {
    const { stdout } = await runNxctl(['user:list', '--json']);
    const parsed = JSON.parse(stdout);
    assert.ok(Array.isArray(parsed.data));
    assert.strictEqual(parsed.data.length, 1);
    assert.strictEqual(parsed.data[0].username, 'admin');
  });

  it('resets password via user:reset:password', async () => {
    const { stdout } = await runNxctl([
      'user:reset:password',
      '--username', 'admin',
      '--password', 'NewAdminPassword!2026',
      '--json'
    ]);
    const parsed = JSON.parse(stdout);
    assert.strictEqual(parsed.message, 'Password reset successfully');
  });

  it('disables MFA for a user via user:disable:mfa', async () => {
    const { stdout } = await runNxctl([
      'user:disable:mfa',
      '--username', 'admin',
      '--json'
    ]);
    const parsed = JSON.parse(stdout);
    assert.strictEqual(parsed.message, 'MFA disabled for user successfully');
  });

  it('syncs and reconciles proxy hosts via proxy:sync', async () => {
    const { stdout } = await runNxctl([
      'proxy:sync',
      '--reconcile',
      '--json'
    ]);
    const parsed = JSON.parse(stdout);
    assert.strictEqual(parsed.message, 'Reconciliation complete');
    assert.strictEqual(parsed.reconciled >= 0, true);
  });

  it('creates, lists, and soft-deletes a site via site:* CLI commands', async () => {
    // 1. site:create
    const createRes = await runNxctl([
      'site:create',
      '--domain', 'cli-test.example.com',
      '--type', 'php',
      '--php', '8.3',
      '--json'
    ]);
    const created = JSON.parse(createRes.stdout);
    assert.strictEqual(created.site.domain, 'cli-test.example.com');
    assert.strictEqual(created.site.type, 'php');

    // 2. site:list
    const listRes = await runNxctl(['site:list', '--json']);
    const listParsed = JSON.parse(listRes.stdout);
    assert.ok(Array.isArray(listParsed.data));
    const found = listParsed.data.find((s: any) => s.domain === 'cli-test.example.com');
    assert.ok(found);

    // 3. site:delete (requires typed domain confirm)
    const deleteRes = await runNxctl([
      'site:delete',
      '--domain', 'cli-test.example.com',
      '--json'
    ]);
    const deleteParsed = JSON.parse(deleteRes.stdout);
    assert.ok(deleteParsed.message.includes('moved to trash'));
  });

  it('provisions, exports, imports, and backs up databases via db:* CLI commands', async () => {
    // 1. db:add
    const addRes = await runNxctl([
      'db:add',
      '--database', 'cli_app_db',
      '--user', 'cli_app_user',
      '--password', 'CliDbSecretPass!2026',
      '--json'
    ]);
    const added = JSON.parse(addRes.stdout);
    assert.strictEqual(added.database.name, 'cli_app_db');
    assert.strictEqual(added.user.username, 'cli_app_user');

    // 2. db:export
    const exportFile = 'temp/cli_app_db.sql.gz';
    const exportRes = await runNxctl([
      'db:export',
      '--database', 'cli_app_db',
      '--file', exportFile,
      '--json'
    ]);
    const exp = JSON.parse(exportRes.stdout);
    assert.strictEqual(exp.message, 'Database exported successfully');

    // 3. db:import
    const importRes = await runNxctl([
      'db:import',
      '--database', 'cli_app_db',
      '--file', exportFile,
      '--json'
    ]);
    const imp = JSON.parse(importRes.stdout);
    assert.ok(imp.jobId);
    assert.strictEqual(imp.message, 'Database import job started');

    // 4. db:backup
    const backupRes = await runNxctl([
      'db:backup',
      '--databases', 'all',
      '--json'
    ]);
    const bkp = JSON.parse(backupRes.stdout);
    assert.strictEqual(bkp.success, true);
    assert.ok(bkp.count >= 1);
  });

  it('runs panel self-backup and enables basic auth via backup:* and panel:* CLI commands', async () => {
    // 1. backup:self
    const selfRes = await runNxctl([
      'backup:self',
      '--json'
    ]);
    const selfBkp = JSON.parse(selfRes.stdout);
    assert.ok(selfBkp.backup?.snapshotId?.startsWith('nexpanel-self-backup-'));
    assert.strictEqual(selfBkp.message, 'Panel self-backup generated successfully');

    // 2. panel:enable:basic-auth
    const authRes = await runNxctl([
      'panel:enable:basic-auth',
      '--username', 'admin',
      '--password', 'PanelGatePass!2026',
      '--json'
    ]);
    const authParsed = JSON.parse(authRes.stdout);
    assert.strictEqual(authParsed.success, true);
    assert.strictEqual(authParsed.username, 'admin');
  });

  it('runs cloudpanel import dry-run and full import via nxctl import:cloudpanel', async () => {
    const fixtureTar = path.resolve(process.cwd(), '../fixtures/cloudpanel/backup.tar');

    // 1. Dry run
    const dryRunRes = await runNxctl([
      'import:cloudpanel',
      '--file', fixtureTar,
      '--dry-run',
      '--json'
    ]);
    const dryRunJson = JSON.parse(dryRunRes.stdout);
    assert.ok(dryRunJson.jobId);
    assert.strictEqual(dryRunJson.dryRun.valid, true);
    assert.strictEqual(dryRunJson.manifest.site.domain, 'example.com');
    assert.strictEqual(dryRunJson.manifest.site.type, 'wordpress');

    // 2. Full Import
    const importRes = await runNxctl([
      'import:cloudpanel',
      '--file', fixtureTar,
      '--json'
    ]);
    const importJson = JSON.parse(importRes.stdout);
    assert.strictEqual(importJson.success, true);
    assert.strictEqual(importJson.report.status, 'done');
    assert.strictEqual(importJson.report.domain, 'example.com');
    assert.strictEqual(importJson.report.verification.configRewritten, true);

    // 3. Rollback
    const rollbackRes = await runNxctl([
      'import:cloudpanel',
      '--rollback', dryRunJson.jobId,
      '--json'
    ]);
    const rollbackJson = JSON.parse(rollbackRes.stdout);
    assert.strictEqual(rollbackJson.success, true);
  });
});
