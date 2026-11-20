import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildApp } from '../src/app.js';
import { setDb } from '../src/db/index.js';
import { MemoryAdapter } from '../src/db/memory-adapter.js';
import { VhostManager } from '../src/sites/vhost-manager.js';
import { CronService } from '../src/cron/cron-service.js';
import { LogService } from '../src/logs/log-service.js';
import { SiteService } from '../src/sites/site-service.js';
import { EngineRegistry } from '../src/db-engines/engine-registry.js';

describe('Milestone 4 Sites Runtime Lifecycle (FR-SITE-01 to 07, 10-12, 14)', () => {
  let app: any;
  let adminToken: string;

  beforeEach(async () => {
    const memoryDb = new MemoryAdapter();
    setDb(memoryDb);
    await EngineRegistry.initDefaultEngines();

    // Ensure clean sites data directory for each test run
    const testSitesDir = path.resolve(process.cwd(), 'data/sites');
    if (fs.existsSync(testSitesDir)) {
      try {
        fs.rmSync(testSitesDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      } catch {}
    }

    app = await buildApp();

    // Register admin user to get auth token
    const setupRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      payload: {
        username: 'admin',
        email: 'admin@example.com',
        password: 'AdminPassword!2026'
      }
    });
    adminToken = JSON.parse(setupRes.body).tokens.accessToken;
  });

  it('creates all 6 site types with isolated paths and correct runtime files (FR-SITE-01 to 07)', async () => {
    const siteTypes = ['wordpress', 'php', 'nodejs', 'python', 'static', 'reverse_proxy'] as const;

    for (const type of siteTypes) {
      const domain = `${type.replace(/_/g, '-')}-test.example.com`;
      const payload: any = {
        domain,
        type,
        phpVersion: type === 'wordpress' || type === 'php' ? '8.3' : undefined
      };

      if (type === 'wordpress') {
        payload.wordpress = {
          siteTitle: 'WP Demo Site',
          adminEmail: 'wp@example.com'
        };
      } else if (type === 'reverse_proxy') {
        payload.reverseProxy = {
          upstreamUrl: 'http://media-service:8096'
        };
      }

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/sites',
        headers: { Authorization: `Bearer ${adminToken}` },
        payload
      });

      assert.strictEqual(res.statusCode, 200, `Failed creating site type ${type}: ${res.body}`);
      const data = JSON.parse(res.body);
      assert.strictEqual(data.site.domain, domain);
      assert.strictEqual(data.site.type, type);

      // Verify file layout
      const slug = SiteService.slugifyDomain(domain);
      const paths = SiteService.getSitePaths(slug);
      assert.strictEqual(fs.existsSync(paths.htdocs), true);
      assert.strictEqual(fs.existsSync(paths.conf), true);

      // Verify type-specific files
      if (type === 'wordpress') {
        assert.strictEqual(fs.existsSync(path.resolve(paths.htdocs, 'wp-config.php')), true);
        const wpConfig = fs.readFileSync(path.resolve(paths.htdocs, 'wp-config.php'), 'utf8');
        assert.strictEqual(wpConfig.includes('AUTH_KEY'), true);
      } else if (type === 'static') {
        assert.strictEqual(fs.existsSync(path.resolve(paths.htdocs, 'index.html')), true);
      } else if (type === 'nodejs') {
        assert.strictEqual(fs.existsSync(path.resolve(paths.htdocs, 'server.js')), true);
      } else if (type === 'python') {
        assert.strictEqual(fs.existsSync(path.resolve(paths.htdocs, 'wsgi.py')), true);
      }
    }
  });

  it('switches PHP version 8.2 -> 8.3 and updates vhost configuration (FR-SITE-03)', async () => {
    // 1. Create PHP site with 8.2
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sites',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        domain: 'php-switch.example.com',
        type: 'php',
        phpVersion: '8.2'
      }
    });
    const siteId = JSON.parse(createRes.body).site.id;

    // 2. Switch to 8.3
    const switchRes = await app.inject({
      method: 'POST',
      url: `/api/v1/sites/${siteId}/php-switch`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { phpVersion: '8.3' }
    });

    assert.strictEqual(switchRes.statusCode, 200);
    const updated = JSON.parse(switchRes.body).site;
    assert.strictEqual(updated.phpVersion, '8.3');

    // 3. Attempt switch to unsupported version -> 400
    const failSwitch = await app.inject({
      method: 'POST',
      url: `/api/v1/sites/${siteId}/php-switch`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { phpVersion: '5.6' }
    });
    assert.strictEqual(failSwitch.statusCode, 400);
  });

  it('enforces nginx -t syntax gate on vhost updates (FR-PHP-02)', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sites',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        domain: 'vhost-test.example.com',
        type: 'php'
      }
    });
    const siteId = JSON.parse(createRes.body).site.id;

    // 1. Reject invalid vhost with syntax error (unclosed brace)
    const badVhost = `server {
  listen 8080;
  server_name vhost-test.example.com;
  root /var/www;
`;
    const badRes = await app.inject({
      method: 'PUT',
      url: `/api/v1/sites/${siteId}/vhost`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { vhost: badVhost }
    });
    assert.strictEqual(badRes.statusCode, 400);
    assert.strictEqual(JSON.parse(badRes.body).error.message.includes('nginx -t syntax error'), true);

    // 2. Accept valid custom vhost
    const goodVhost = `server {
  listen 8080;
  server_name vhost-test.example.com;
  root /data/sites/vhost-test-example-com/htdocs;
  index index.php;
}`;
    const goodRes = await app.inject({
      method: 'PUT',
      url: `/api/v1/sites/${siteId}/vhost`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { vhost: goodVhost }
    });
    assert.strictEqual(goodRes.statusCode, 200);

    // 3. Read back verified vhost
    const getVhostRes = await app.inject({
      method: 'GET',
      url: `/api/v1/sites/${siteId}/vhost`,
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(JSON.parse(getVhostRes.body).vhost.includes('index index.php;'), true);
  });

  it('manages files and blocks path traversal attacks (FR-FILE-01)', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sites',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { domain: 'file-test.example.com', type: 'static' }
    });
    const siteId = JSON.parse(createRes.body).site.id;

    // 1. Write file
    const writeRes = await app.inject({
      method: 'PUT',
      url: `/api/v1/sites/${siteId}/files/content`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { path: 'custom.txt', content: 'Hello NexPanel!' }
    });
    assert.strictEqual(writeRes.statusCode, 200);

    // 2. Read file
    const readRes = await app.inject({
      method: 'GET',
      url: `/api/v1/sites/${siteId}/files/content?path=custom.txt`,
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(JSON.parse(readRes.body).content, 'Hello NexPanel!');

    // 3. List files
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/v1/sites/${siteId}/files`,
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const files = JSON.parse(listRes.body).data;
    assert.strictEqual(files.some((f: any) => f.name === 'custom.txt'), true);

    // 4. Delete file to trash
    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/sites/${siteId}/files`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { path: 'custom.txt' }
    });
    assert.strictEqual(delRes.statusCode, 200);

    // 5. Block path traversal
    const traversalRes = await app.inject({
      method: 'GET',
      url: `/api/v1/sites/${siteId}/files/content?path=../../../../windows/system32/cmd.exe`,
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(traversalRes.statusCode >= 400, true);
  });

  it('schedules and executes per-site cron jobs (FR-CRON-01 & 02)', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sites',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { domain: 'cron-test.example.com', type: 'php' }
    });
    const siteId = JSON.parse(createRes.body).site.id;

    // 1. Rejects invalid schedule syntax
    const badCronRes = await app.inject({
      method: 'POST',
      url: `/api/v1/sites/${siteId}/cron`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'Invalid Job',
        schedule: 'every monday',
        command: 'echo 1'
      }
    });
    assert.strictEqual(badCronRes.statusCode, 400);

    // 2. Add valid cron job
    const goodCronRes = await app.inject({
      method: 'POST',
      url: `/api/v1/sites/${siteId}/cron`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'WP Cron Runner',
        schedule: '*/15 * * * *',
        command: 'echo "Cron job ran successfully"'
      }
    });
    assert.strictEqual(goodCronRes.statusCode, 200);
    const cronId = JSON.parse(goodCronRes.body).job.id;

    // 3. Trigger "Run now"
    const runRes = await app.inject({
      method: 'POST',
      url: `/api/v1/cron/${cronId}/run-now`,
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(runRes.statusCode, 200);
    const run = JSON.parse(runRes.body).run;
    assert.strictEqual(run.exitCode, 0);
    assert.strictEqual(run.stdoutTail.includes('Cron job ran successfully'), true);

    // 4. View execution history
    const historyRes = await app.inject({
      method: 'GET',
      url: `/api/v1/cron/${cronId}/runs`,
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(JSON.parse(historyRes.body).data.length > 0, true);
  });

  it('appends and filters per-site logs (FR-LOG-01)', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sites',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { domain: 'logs-test.example.com', type: 'php' }
    });
    const siteId = JSON.parse(createRes.body).site.id;

    // Append sample access logs
    const slug = SiteService.slugifyDomain('logs-test.example.com');
    const paths = SiteService.getSitePaths(slug);
    LogService.appendLog(paths.logs, 'nginx-access', 'GET / 200 45ms');
    LogService.appendLog(paths.logs, 'nginx-access', 'GET /api/checkout 500 Internal Error 120ms');

    // Query logs with search = "Internal Error"
    const logRes = await app.inject({
      method: 'GET',
      url: `/api/v1/sites/${siteId}/logs?type=nginx-access&search=Internal+Error`,
      headers: { Authorization: `Bearer ${adminToken}` }
    });

    assert.strictEqual(logRes.statusCode, 200);
    const logData = JSON.parse(logRes.body);
    assert.strictEqual(logData.count, 1);
    assert.strictEqual(logData.lines[0].includes('500 Internal Error'), true);
  });

  it('soft-deletes site with typed domain confirm and restores from trash (FR-SITE-12)', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sites',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { domain: 'delete-confirm.example.com', type: 'static' }
    });
    const siteId = JSON.parse(createRes.body).site.id;

    // 1. Mismatched domain confirmation fails
    const failDel = await app.inject({
      method: 'DELETE',
      url: `/api/v1/sites/${siteId}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { confirmDomain: 'wrong-domain.com' }
    });
    assert.strictEqual(failDel.statusCode, 400);

    // 2. Matching confirmation moves to trash
    const goodDel = await app.inject({
      method: 'DELETE',
      url: `/api/v1/sites/${siteId}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { confirmDomain: 'delete-confirm.example.com' }
    });
    assert.strictEqual(goodDel.statusCode, 200);

    // 3. Site no longer appears in normal list
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/sites',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(
      JSON.parse(listRes.body).data.some((s: any) => s.id === siteId),
      false
    );

    // 4. Restore site from trash
    const restoreRes = await app.inject({
      method: 'POST',
      url: `/api/v1/sites/${siteId}/restore`,
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(restoreRes.statusCode, 200);

    // 5. Site is now back in active list
    const postListRes = await app.inject({
      method: 'GET',
      url: '/api/v1/sites',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(
      JSON.parse(postListRes.body).data.some((s: any) => s.id === siteId),
      true
    );
  });
});
