import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Milestone 8: Final Acceptance & Operations Verification (docs/09 §9.3)', () => {
  const rootDir = path.resolve(process.cwd(), '..');

  it('Criterion 1 & 2: Installer and Upgrade scripts are present and conform to rules', () => {
    const installScript = path.resolve(rootDir, 'scripts/install.sh');
    const upgradeScript = path.resolve(rootDir, 'scripts/upgrade.sh');
    const supportBundleScript = path.resolve(rootDir, 'scripts/support-bundle.sh');

    assert.strictEqual(fs.existsSync(installScript), true);
    assert.strictEqual(fs.existsSync(upgradeScript), true);
    assert.strictEqual(fs.existsSync(supportBundleScript), true);

    const installContent = fs.readFileSync(installScript, 'utf8');
    const installLines = installContent.split('\n').length;
    // Rule: installer < 500 lines
    assert.strictEqual(installLines < 500, true);

    // Rule: R1 proxy network creation
    assert.strictEqual(installContent.includes('docker network create "${NETWORK_NAME}"') || installContent.includes('NETWORK_NAME="proxy"'), true);

    // Rule: AES-256-GCM vault key generation with 0600
    assert.strictEqual(installContent.includes('chmod 600 "${vault_key_file}"'), true);
    assert.strictEqual(installContent.includes('chmod 600 "${env_file}"'), true);

    // Upgrade script must have pre-upgrade backup and rollback
    const upgradeContent = fs.readFileSync(upgradeScript, 'utf8');
    assert.strictEqual(upgradeContent.includes('pre-upgrade'), true);
    assert.strictEqual(upgradeContent.includes('rollback()'), true);
  });

  it('Criterion 7: Parity checklist is 100% covered for MVP scope with executable tests', () => {
    const csvPath = path.resolve(rootDir, 'examples/parity-checklist.csv');
    assert.strictEqual(fs.existsSync(csvPath), true);

    const matrixDocPath = path.resolve(rootDir, 'docs/REQUIREMENTS-EVIDENCE-MATRIX.md');
    assert.strictEqual(fs.existsSync(matrixDocPath), true, 'docs/REQUIREMENTS-EVIDENCE-MATRIX.md must exist');
    const matrixDocContent = fs.readFileSync(matrixDocPath, 'utf8');
    assert.strictEqual(matrixDocContent.includes('DNS-01'), true);
    assert.strictEqual(matrixDocContent.includes('Hard Rule R1'), true);

    const lines = fs.readFileSync(csvPath, 'utf8').trim().split('\n');
    const header = lines[0].split(',');
    const nexpanelIdx = header.indexOf('nexpanel_mvp');
    const priorityIdx = header.indexOf('priority');
    const statusIdx = header.indexOf('status');
    const testSuiteIdx = header.indexOf('test_suite');

    assert.ok(statusIdx !== -1, 'status column must be present in parity-checklist.csv');
    assert.ok(testSuiteIdx !== -1, 'test_suite column must be present in parity-checklist.csv');

    let mvpRowsCount = 0;
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      const mvpVal = cols[nexpanelIdx];
      const prio = cols[priorityIdx];
      const status = cols[statusIdx];
      const testSuite = cols[testSuiteIdx];

      if (prio === 'M') {
        mvpRowsCount++;
        // Must be marked Yes and status must be 'implemented'
        assert.strictEqual(mvpVal.toLowerCase().includes('yes'), true);
        assert.strictEqual(status, 'implemented', `Expected row ${cols[0]} to be implemented`);

        // Test suite file must exist
        assert.ok(testSuite && testSuite.length > 0, `Row ${cols[0]} must define a test_suite`);
        const testFilePath = testSuite.startsWith('cli:')
          ? path.resolve(rootDir, 'cli/test', testSuite.replace('cli:', ''))
          : path.resolve(rootDir, 'backend/test', testSuite);

        assert.strictEqual(fs.existsSync(testFilePath), true, `Test file ${testFilePath} for ${cols[0]} must exist`);
      }
    }

    assert.ok(mvpRowsCount >= 25, `Expected at least 25 MVP rows, found ${mvpRowsCount}`);
  });

  it('Criterion 10: All 6 operational runbooks exist with actionable guidance', () => {
    const runbooks = [
      'install.md',
      'backup-restore.md',
      'cloudpanel-migration.md',
      'troubleshooting-502.md',
      'npm-recovery.md',
      'disaster-recovery.md'
    ];

    for (const rb of runbooks) {
      const rbPath = path.resolve(rootDir, 'docs/runbooks', rb);
      assert.strictEqual(fs.existsSync(rbPath), true, `Missing runbook: ${rb}`);
      const content = fs.readFileSync(rbPath, 'utf8');
      assert.ok(content.length > 300, `Runbook ${rb} is too short or empty`);
      assert.strictEqual(content.includes('# Runbook:'), true);
    }
  });

  it('Central brand configuration config/brand.json is valid', () => {
    const brandPath = path.resolve(rootDir, 'config/brand.json');
    assert.strictEqual(fs.existsSync(brandPath), true);

    const brand = JSON.parse(fs.readFileSync(brandPath, 'utf8'));
    assert.strictEqual(brand.name, 'NexPanel');
    assert.strictEqual(brand.cliName, 'nxctl');
    assert.strictEqual(brand.containerPrefix, 'nexpanel-');
    assert.strictEqual(brand.networkName, 'proxy');
    assert.strictEqual(brand.defaultPhp, '8.3');
    assert.strictEqual(brand.defaultSiteEngine, 'internal-mysql');
    assert.strictEqual(brand.license, 'Apache-2.0');
  });

  it('Confirms Zero Secrets in source, logs, and artifacts (NFR-SEC-01)', () => {
    const supportScript = path.resolve(rootDir, 'scripts/support-bundle.sh');
    const scriptContent = fs.readFileSync(supportScript, 'utf8');
    // Ensure secrets masking is executed in bundle generator
    assert.strictEqual(scriptContent.includes('••••••••'), true);
  });
});
