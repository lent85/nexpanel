import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as http from 'node:http';
import { execSync } from 'node:child_process';
import { NpmClient } from '../src/edge/npm-client.js';
import { NpmEdgeProvider } from '../src/edge/npm-provider.js';

interface AppDefinition {
  name: string;
  domain: string;
  containerName: string;
  image: string;
  port: number;
  runtime: 'php' | 'nodejs';
  version: string;
  startCommand: string;
}

function requestHttp(options: {
  host?: string;
  port?: number;
  path?: string;
  headers?: Record<string, string>;
}): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: options.host || '127.0.0.1',
        port: options.port || 80,
        path: options.path || '/',
        headers: options.headers || {}
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () =>
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers,
            body
          })
        );
      }
    );
    req.on('error', reject);
    req.end();
  });
}

describe('Multi-Runtime Deployment & NPM Reverse Proxy Verification', () => {
  const npmBaseUrl = process.env.LIVE_NPM_BASE_URL || 'http://127.0.0.1:81';
  const npmAdminEmail = process.env.LIVE_NPM_EMAIL || 'admin@example.com';
  const npmAdminPassword = process.env.LIVE_NPM_PASSWORD || 'changeme';

  const client = new NpmClient({
    baseUrl: npmBaseUrl,
    adminEmail: npmAdminEmail,
    adminPassword: npmAdminPassword
  });
  const provider = new NpmEdgeProvider(client);

  let isNpmLive = false;
  const createdHostIds: number[] = [];

  const apps: AppDefinition[] = [
    {
      name: 'PHP 8.2 Application',
      domain: 'app-php82.local',
      containerName: 'app-php82-site',
      image: 'php:8.2-alpine',
      port: 8080,
      runtime: 'php',
      version: '8.2',
      startCommand:
        'docker run -d --name app-php82-site --network proxy php:8.2-alpine ' +
        'sh -c \'mkdir -p /app && echo "<?php header(\\"Content-Type: application/json\\"); echo json_encode([\\"runtime\\"=>\\"php\\",\\"version\\"=>\\"8.2\\",\\"exactVersion\\"=>PHP_VERSION,\\"domain\\"=>\\"app-php82.local\\"]);" > /app/index.php && php -S 0.0.0.0:8080 -t /app\''
    },
    {
      name: 'PHP 8.3 Application',
      domain: 'app-php83.local',
      containerName: 'app-php83-site',
      image: 'php:8.3-alpine',
      port: 8080,
      runtime: 'php',
      version: '8.3',
      startCommand:
        'docker run -d --name app-php83-site --network proxy php:8.3-alpine ' +
        'sh -c \'mkdir -p /app && echo "<?php header(\\"Content-Type: application/json\\"); echo json_encode([\\"runtime\\"=>\\"php\\",\\"version\\"=>\\"8.3\\",\\"exactVersion\\"=>PHP_VERSION,\\"domain\\"=>\\"app-php83.local\\"]);" > /app/index.php && php -S 0.0.0.0:8080 -t /app\''
    },
    {
      name: 'Node.js 20 Application',
      domain: 'app-node20.local',
      containerName: 'app-node20-site',
      image: 'node:20-alpine',
      port: 3000,
      runtime: 'nodejs',
      version: '20',
      startCommand:
        'docker run -d --name app-node20-site --network proxy node:20-alpine ' +
        'node -e \'require("http").createServer((req,res)=>{res.setHeader("Content-Type","application/json");res.end(JSON.stringify({runtime:"nodejs",version:"20",exactVersion:process.version,domain:"app-node20.local"}))}).listen(3000,"0.0.0.0")\''
    },
    {
      name: 'Node.js 22 Application',
      domain: 'app-node22.local',
      containerName: 'app-node22-site',
      image: 'node:22-bookworm-slim',
      port: 3000,
      runtime: 'nodejs',
      version: '22',
      startCommand:
        'docker run -d --name app-node22-site --network proxy node:22-bookworm-slim ' +
        'node -e \'require("http").createServer((req,res)=>{res.setHeader("Content-Type","application/json");res.end(JSON.stringify({runtime:"nodejs",version:"22",exactVersion:process.version,domain:"app-node22.local"}))}).listen(3000,"0.0.0.0")\''
    },
    {
      name: 'Node.js 24 Application',
      domain: 'app-node24.local',
      containerName: 'app-node24-site',
      image: 'node:24-alpine',
      port: 3000,
      runtime: 'nodejs',
      version: '24',
      startCommand:
        'docker run -d --name app-node24-site --network proxy node:24-alpine ' +
        'node -e \'require("http").createServer((req,res)=>{res.setHeader("Content-Type","application/json");res.end(JSON.stringify({runtime:"nodejs",version:"24",exactVersion:process.version,domain:"app-node24.local"}))}).listen(3000,"0.0.0.0")\''
    }
  ];

  before(async () => {
    try {
      const health = await client.health();
      if (health.ok) {
        isNpmLive = true;
      }
    } catch {
      isNpmLive = false;
    }

    if (!isNpmLive) {
      console.log('NOTICE: Live NPM container not reachable — skipping multi-runtime deployment tests.');
      return;
    }

    // Deploy all containers on the 'proxy' Docker network
    for (const app of apps) {
      try {
        execSync(`docker rm -f ${app.containerName}`, { stdio: 'ignore' });
      } catch {}

      execSync(app.startCommand, { stdio: 'ignore' });

      // Create proxy host in NPM forwarding to the container name
      const res = await provider.createHost({
        domainNames: [app.domain],
        forwardScheme: 'http',
        forwardHost: app.containerName,
        forwardPort: app.port,
        sslForced: false,
        hstsEnabled: false,
        http2Support: true,
        websocketSupport: true,
        enabled: true
      });
      createdHostIds.push(res.edgeId);
      // Brief pause between creation to allow NPM template reload
      await new Promise((resolve) => setTimeout(resolve, 800));
    }

    // Give Nginx inside NPM 2 seconds to reload all host configurations
    await new Promise((resolve) => setTimeout(resolve, 2000));
  });

  after(async () => {
    // 1. Delete all created proxy hosts from NPM
    for (const hostId of createdHostIds) {
      try {
        await provider.deleteHost(hostId);
      } catch {}
    }

    // 2. Stop and remove all test app containers
    for (const app of apps) {
      try {
        execSync(`docker rm -f ${app.containerName}`, { stdio: 'ignore' });
      } catch {}
    }
  });

  it('verifies all 5 applications route through NPM on port 80 and return correct runtime versions', async (t) => {
    if (!isNpmLive) return t.skip('Live NPM not running');

    for (const app of apps) {
      const res = await requestHttp({
        host: '127.0.0.1',
        port: 80,
        path: '/',
        headers: {
          Host: app.domain
        }
      });

      assert.strictEqual(res.statusCode, 200, `Expected 200 for ${app.domain}`);
      assert.strictEqual(res.headers.server?.includes('openresty'), true, 'Expected openresty server header');

      const json = JSON.parse(res.body);
      assert.strictEqual(json.runtime, app.runtime);
      assert.strictEqual(json.version, app.version);
      assert.strictEqual(json.domain, app.domain);

      if (app.runtime === 'php') {
        assert.strictEqual(json.exactVersion.startsWith(app.version), true);
      } else {
        assert.strictEqual(json.exactVersion.startsWith(`v${app.version}`), true);
      }
    }
  });

  it('handles simultaneous concurrent traffic across different PHP and Node versions', async (t) => {
    if (!isNpmLive) return t.skip('Live NPM not running');

    // Send 15 parallel requests (3 per app) across all runtimes simultaneously
    const requests = apps.flatMap((app) =>
      [1, 2, 3].map(async () => {
        const res = await requestHttp({
          host: '127.0.0.1',
          port: 80,
          path: '/',
          headers: { Host: app.domain }
        });
        assert.strictEqual(res.statusCode, 200);
        const data = JSON.parse(res.body);
        assert.strictEqual(data.domain, app.domain);
        assert.strictEqual(data.version, app.version);
        return data;
      })
    );

    const results = await Promise.all(requests);
    assert.strictEqual(results.length, 15);
  });

  it('supports runtime host lifecycle isolation: disabling one app does not affect others', async (t) => {
    if (!isNpmLive) return t.skip('Live NPM not running');

    const php82HostId = createdHostIds[0];
    const node24App = apps[4]; // app-node24.local

    // Disable PHP 8.2 host in NPM
    await provider.setHostEnabled(php82HostId, false);
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Request to PHP 8.2 should no longer hit the container (routes to fallback welcome page)
    const disabledRes = await requestHttp({
      host: '127.0.0.1',
      port: 80,
      path: '/',
      headers: { Host: 'app-php82.local' }
    });
    assert.strictEqual(disabledRes.body.includes('Congratulations!'), true);

    // Node 24 application remains fully responsive (200 OK)
    const nodeRes = await requestHttp({
      host: '127.0.0.1',
      port: 80,
      path: '/',
      headers: { Host: node24App.domain }
    });
    assert.strictEqual(nodeRes.statusCode, 200);
    const nodeData = JSON.parse(nodeRes.body);
    assert.strictEqual(nodeData.version, '24');

    // Re-enable PHP 8.2 host
    await provider.setHostEnabled(php82HostId, true);
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const reenabledRes = await requestHttp({
      host: '127.0.0.1',
      port: 80,
      path: '/',
      headers: { Host: 'app-php82.local' }
    });
    assert.strictEqual(reenabledRes.statusCode, 200);
    const phpData = JSON.parse(reenabledRes.body);
    assert.strictEqual(phpData.version, '8.2');
  });
});
