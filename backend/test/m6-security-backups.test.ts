import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { setDb } from '../src/db/index.js';
import { MemoryAdapter } from '../src/db/memory-adapter.js';
import { AuthService } from '../src/auth/auth-service.js';
import { FirewallManager } from '../src/security/firewall-manager.js';
import { SiteSecurityManager } from '../src/security/site-security-manager.js';
import { DestinationManager } from '../src/backups/destination-manager.js';
import { BackupService } from '../src/backups/backup-service.js';
import { RestoreService } from '../src/backups/restore-service.js';
import { SelfBackupService } from '../src/backups/self-backup-service.js';
import { SiteService } from '../src/sites/site-service.js';
import { DbProvisioner } from '../src/db-engines/db-provisioner.js';
import { EngineRegistry } from '../src/db-engines/engine-registry.js';
import { setMockEdgeProvider } from '../src/api/v1/edge.routes.js';
import { NpmEdgeProvider } from '../src/edge/npm-provider.js';

describe('Milestone 6 Security & Backups (FR-SEC-03, 04; FR-BKP-01 to 05; NFR-SEC-08, 12)', () => {
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
    await EngineRegistry.initDefaultEngines();
    await FirewallManager.initDefaultRules();
  });

  it('manages host firewall with UFW presets and blocks system rule deletion (FR-SEC-03)', async () => {
    // 1. List rules - must contain system presets (22, 80, 443, 8443)
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/security/firewall',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(listRes.statusCode, 200);
    const rules = listRes.json().data;
    assert.ok(rules.length >= 4);

    const sshRule = rules.find((r: any) => r.port === '22');
    assert.ok(sshRule);
    assert.strictEqual(sshRule.is_system, true);

    // 2. Generate UFW command
    const ufwCmd = FirewallManager.generateUfwCommand(sshRule);
    assert.ok(ufwCmd.startsWith('ufw allow proto tcp'));
    assert.ok(ufwCmd.includes('port 22'));

    // 3. Attempting to delete a system rule must fail
    const delSystemRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/security/firewall/${sshRule.id}`,
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(delSystemRes.statusCode, 500);
    assert.ok(delSystemRes.json().error.message.includes('Cannot delete system firewall rule'));

    // 4. Add custom rule
    const addRes = await app.inject({
      method: 'POST',
      url: '/api/v1/security/firewall',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        action: 'allow',
        port: '9090',
        protocol: 'tcp',
        sourceIp: '192.168.1.100',
        description: 'Cockpit Admin'
      }
    });
    assert.strictEqual(addRes.statusCode, 201);
    const addedRule = addRes.json().rule;
    assert.strictEqual(addedRule.port, '9090');

    // 5. Delete custom rule
    const delCustomRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/security/firewall/${addedRule.id}`,
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(delCustomRes.statusCode, 200);
  });

  it('detects Docker published host ports and surfaces UFW bypass warnings (NFR-SEC-08, FR-SEC-03)', async () => {
    // Simulate container port mappings
    const activeMappings = [
      { containerName: 'npm-gateway', hostPort: 80, containerPort: 80, bindIp: '0.0.0.0' },
      { containerName: 'npm-gateway', hostPort: 443, containerPort: 443, bindIp: '0.0.0.0' },
      { containerName: 'exposed-mysql-container', hostPort: 3306, containerPort: 3306, bindIp: '0.0.0.0' },
      { containerName: 'custom-app', hostPort: 8080, containerPort: 8080, bindIp: '0.0.0.0' }
    ];

    const warnings = await FirewallManager.inspectDockerPublishedPorts(activeMappings);
    // Port 80 and 443 are expected gateway ports; 3306 and 8080 must trigger UFW bypass warnings
    assert.strictEqual(warnings.length, 2);

    const dbWarning = warnings.find((w) => w.hostPort === 3306);
    assert.ok(dbWarning);
    assert.ok(dbWarning.warning.includes('bypassing UFW firewall rules'));
    assert.ok(dbWarning.warning.includes('directly reachable from the internet'));
  });

  it('enforces per-site security: IP block, bot block, Cloudflare-only, security headers (FR-SEC-04)', async () => {
    const site = await SiteService.createSite({
      domain: 'security-test.example.com',
      type: 'php',
      phpVersion: '8.3'
    });

    // 1. Add IP block
    const ipBlockRes = await app.inject({
      method: 'POST',
      url: `/api/v1/sites/${site.id}/security`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        ruleType: 'ip_block',
        target: '203.0.113.42'
      }
    });
    assert.strictEqual(ipBlockRes.statusCode, 201);

    // 2. Add Bot block
    const botBlockRes = await app.inject({
      method: 'POST',
      url: `/api/v1/sites/${site.id}/security`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        ruleType: 'bot_block',
        target: 'semrush'
      }
    });
    assert.strictEqual(botBlockRes.statusCode, 201);

    // 3. Add Cloudflare-only mode
    const cfRes = await app.inject({
      method: 'POST',
      url: `/api/v1/sites/${site.id}/security`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        ruleType: 'cloudflare_only',
        target: 'all'
      }
    });
    assert.strictEqual(cfRes.statusCode, 201);

    // 4. Add Security Headers
    const secHeadersRes = await app.inject({
      method: 'POST',
      url: `/api/v1/sites/${site.id}/security`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        ruleType: 'security_headers',
        target: 'all'
      }
    });
    assert.strictEqual(secHeadersRes.statusCode, 201);

    // 5. Inspect generated Nginx snippet
    const snippetRes = await app.inject({
      method: 'GET',
      url: `/api/v1/sites/${site.id}/security/nginx-snippet`,
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(snippetRes.statusCode, 200);
    const snippet = snippetRes.json().snippet;

    // Verify rules translated accurately
    assert.ok(snippet.includes('deny 203.0.113.42;'));
    assert.ok(snippet.includes('if ($http_user_agent ~* (semrush))'));
    assert.ok(snippet.includes('set_real_ip_from 173.245.48.0/20;'));
    assert.ok(snippet.includes('deny all;'));
    assert.ok(snippet.includes('add_header X-Content-Type-Options "nosniff"'));

    // Verify written to site conf directory
    const confFile = path.resolve(site.volumePath, 'conf', 'security.conf');
    assert.strictEqual(fs.existsSync(confFile), true);
  });

  it('manages remote backup destinations with NFR-SEC-12 encryption warning (FR-BKP-01)', async () => {
    // 1. Create encrypted destination (no warning)
    const encRes = await app.inject({
      method: 'POST',
      url: '/api/v1/backup-destinations',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'AWS S3 Vault Bucket',
        provider: 's3',
        config: {
          bucket: 'production-nexpanel-backups',
          region: 'us-east-1',
          accessKey: 'AKIA123456789',
          secretKey: 'SecretKey123',
          encrypted: true
        }
      }
    });
    assert.strictEqual(encRes.statusCode, 201);
    assert.strictEqual(encRes.json().warning, undefined);
    const encDest = encRes.json().destination;

    // 2. Create unencrypted destination (must show NFR-SEC-12 warning)
    const unencRes = await app.inject({
      method: 'POST',
      url: '/api/v1/backup-destinations',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'Unencrypted Wasabi Bucket',
        provider: 'wasabi',
        config: {
          bucket: 'raw-backups',
          encrypted: false
        }
      }
    });
    assert.strictEqual(unencRes.statusCode, 201);
    assert.ok(unencRes.json().warning.includes('NFR-SEC-12 Warning'));

    // 3. Test destination connectivity
    const testRes = await app.inject({
      method: 'POST',
      url: `/api/v1/backup-destinations/${encDest.id}/test`,
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(testRes.statusCode, 200);
    assert.strictEqual(testRes.json().result.ok, true);
  });

  it('performs on-demand site backup and 1-click restore with pre-restore safety snapshot (FR-BKP-02, 03)', async () => {
    // 1. Create WordPress site with database
    const site = await SiteService.createSite({
      domain: 'restore-demo.example.com',
      type: 'wordpress',
      phpVersion: '8.3'
    });

    await DbProvisioner.createDatabaseAndUser({
      siteId: site.id,
      name: 'wp_restore_db',
      user: { username: 'wp_restore_user' }
    });

    const indexPhp = path.resolve(site.volumePath, 'htdocs', 'index.php');
    fs.writeFileSync(indexPhp, '<?php echo "Original WP State V1"; ?>');

    // 2. Take on-demand site backup
    const bkpRes = await app.inject({
      method: 'POST',
      url: `/api/v1/sites/${site.id}/backups`,
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(bkpRes.statusCode, 201);
    const backup = bkpRes.json().backup;
    assert.ok(backup.snapshotId);
    assert.strictEqual(fs.existsSync(backup.archivePath), true);

    // 3. Simulate disaster: corrupt site files
    fs.writeFileSync(indexPhp, '<?php echo "CORRUPTED FILE CONTENTS"; ?>');

    // 4. Perform 1-Click Restore in UI (FR-BKP-02)
    const restoreRes = await app.inject({
      method: 'POST',
      url: '/api/v1/backups/restore',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        siteId: site.id,
        snapshotPathOrId: backup.snapshotId,
        restoreFiles: true,
        restoreDb: true,
        preRestoreBackup: true
      }
    });
    assert.strictEqual(restoreRes.statusCode, 200);
    const result = restoreRes.json().result;
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.filesRestored, true);
    assert.ok(result.preRestoreSnapshotId, 'Pre-restore safety snapshot must be taken');

    // 5. Verify restored file state
    const restoredContent = fs.readFileSync(indexPhp, 'utf8');
    assert.strictEqual(restoredContent, '<?php echo "Original WP State V1"; ?>');
  });

  it('creates panel self-backup and executes restore drill (FR-BKP-05, NFR-REL-05)', async () => {
    // 1. Generate panel self-backup
    const selfBkpRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/self-backup',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(selfBkpRes.statusCode, 200);
    const bkp = selfBkpRes.json().backup;
    assert.ok(bkp.snapshotId.startsWith('nexpanel-self-backup-'));
    assert.strictEqual(fs.existsSync(bkp.archivePath), true);

    // 2. Execute restore drill
    const drillRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/self-backup/restore',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        archivePath: bkp.archivePath
      }
    });
    assert.strictEqual(drillRes.statusCode, 200);
    assert.strictEqual(drillRes.json().success, true);
  });
});
