import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import * as tar from 'tar';
import { TarValidator } from '../src/importer/tar-validator.js';

describe('Milestone 2 Fixtures & Docker Lab Verification', () => {
  const fixturesDir = path.resolve(process.cwd(), '../fixtures/cloudpanel');
  const labComposePath = path.resolve(process.cwd(), '../docker/lab-compose.yml');

  it('verifies synthetic remote backup.tar structure and content', async () => {
    const backupTarPath = path.resolve(fixturesDir, 'backup.tar');
    assert.strictEqual(fs.existsSync(backupTarPath), true);
    assert.strictEqual(fs.statSync(backupTarPath).size > 0, true);

    const validCheck = await TarValidator.validate(backupTarPath);
    assert.strictEqual(validCheck.valid, true);

    const entries: string[] = [];
    await tar.t({
      file: backupTarPath,
      onentry: (entry) => {
        entries.push(entry.path.replace(/\\/g, '/'));
      }
    });

    // Check required paths per docs/05 §5.1A
    assert.strictEqual(entries.some((e) => e.includes('htdocs/example.com/wp-config.php')), true);
    assert.strictEqual(entries.some((e) => e.includes('backups/wp_example-2026-11-18.sql.gz')), true);
    assert.strictEqual(entries.some((e) => e.includes('home/examplecom/conf/nginx/example.com.conf')), true);

    // Verify exclusions per docs/05 §5.1A
    assert.strictEqual(entries.some((e) => e.startsWith('.ssh') || e.includes('/.ssh')), false);
    assert.strictEqual(entries.some((e) => e === 'logs' || e.startsWith('logs/')), false);
    assert.strictEqual(entries.some((e) => e === 'tmp' || e.startsWith('tmp/')), false);
  });

  it('decompresses and verifies SQL dump within backup.tar', async () => {
    const tempExtractDir = path.resolve(fixturesDir, 'temp-verify');
    if (fs.existsSync(tempExtractDir)) {
      fs.rmSync(tempExtractDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempExtractDir, { recursive: true });

    try {
      await tar.x({
        file: path.resolve(fixturesDir, 'backup.tar'),
        cwd: tempExtractDir
      });

      const dumpPath = path.resolve(tempExtractDir, 'backups/wp_example-2026-11-18.sql.gz');
      assert.strictEqual(fs.existsSync(dumpPath), true);

      const decompressed = zlib.gunzipSync(fs.readFileSync(dumpPath)).toString('utf8');
      assert.strictEqual(decompressed.includes('wp_options'), true);
      assert.strictEqual(decompressed.includes('wp_users'), true);
      assert.strictEqual(decompressed.includes('https://example.com'), true);
    } finally {
      fs.rmSync(tempExtractDir, { recursive: true, force: true });
    }
  });

  it('verifies local-files.tar.gz + local-db.sql.gz pair', async () => {
    const localFilesPath = path.resolve(fixturesDir, 'local-files.tar.gz');
    const localDbPath = path.resolve(fixturesDir, 'local-db.sql.gz');

    assert.strictEqual(fs.existsSync(localFilesPath), true);
    assert.strictEqual(fs.existsSync(localDbPath), true);

    const localEntries: string[] = [];
    await tar.t({
      file: localFilesPath,
      onentry: (entry) => {
        localEntries.push(entry.path.replace(/\\/g, '/'));
      }
    });

    assert.strictEqual(localEntries.some((e) => e.includes('wp-config.php')), true);

    const decompressed = zlib.gunzipSync(fs.readFileSync(localDbPath)).toString('utf8');
    assert.strictEqual(decompressed.includes('wp_options'), true);
  });

  it('fails fast on corrupted/truncated broken.tar (NFR-COMP-04)', async () => {
    const brokenTarPath = path.resolve(fixturesDir, 'broken.tar');
    assert.strictEqual(fs.existsSync(brokenTarPath), true);

    const check = await TarValidator.validate(brokenTarPath);
    assert.strictEqual(check.valid, false);
    assert.strictEqual(check.error?.includes('truncated') || check.error?.includes('corrupted'), true);

    // Also test with explicit expected size mismatch
    const sizeCheck = await TarValidator.validate(brokenTarPath, 20000);
    assert.strictEqual(sizeCheck.valid, false);
    assert.strictEqual(sizeCheck.error?.includes('expected 20000 bytes'), true);
  });

  it('validates lab-compose.yml adheres to R1 and R2 non-negotiable rules', () => {
    assert.strictEqual(fs.existsSync(labComposePath), true);
    const content = fs.readFileSync(labComposePath, 'utf8');

    // Rule R1: NPM owns 80/443 on external network 'proxy'
    assert.strictEqual(content.includes('jc21/nginx-proxy-manager:2.16.0'), true);
    assert.strictEqual(content.includes('"80:80"'), true);
    assert.strictEqual(content.includes('"443:443"'), true);
    assert.strictEqual(content.includes('name: proxy'), true);
    assert.strictEqual(content.includes('external: true'), true);

    // Rule R2: Database engines (MySQL 8.4, MariaDB, Postgres) run without publishing host ports
    assert.strictEqual(content.includes('container_name: nexpanel-mysql'), true);
    assert.strictEqual(content.includes('container_name: external-mysql'), true);
    assert.strictEqual(content.includes('container_name: external-mariadb'), true);
    assert.strictEqual(content.includes('container_name: external-postgres'), true);

    // Ensure DB engines do not expose 3306 or 5432 to host ports
    assert.strictEqual(content.includes('"3306:3306"'), false);
    assert.strictEqual(content.includes('"5432:5432"'), false);
  });
});
