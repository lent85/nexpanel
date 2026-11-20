import * as http from 'node:http';
import { execSync } from 'node:child_process';

const PANEL_URL = 'http://127.0.0.1:8444';
const NPM_URL = 'http://127.0.0.1:80';

async function fetchJson(url: string, options: any = {}) {
  const headers: Record<string, string> = {
    ...(options.headers || {})
  };
  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  try {
    return { status: res.status, ok: res.ok, data: JSON.parse(text) };
  } catch {
    return { status: res.status, ok: res.ok, data: text };
  }
}

function requestHttp(options: {
  host?: string;
  port?: number;
  path?: string;
  headers?: Record<string, string>;
}): Promise<{ statusCode: number; body: string }> {
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
        res.on('end', () => resolve({ statusCode: res.statusCode || 0, body }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function run(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf8' }).trim();
  } catch (err: any) {
    return `ERROR: ${err.message}`;
  }
}

async function main() {
  console.log('================================================================');
  console.log('   NexPanel Docker Local & NPM-Extend Collaboration Test Suite  ');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  function assertTest(name: string, condition: boolean, details?: string) {
    total++;
    if (condition) {
      passed++;
      console.log(`[PASS] ${name}`);
      if (details) console.log(`       ${details}`);
    } else {
      console.error(`[FAIL] ${name}`);
      if (details) console.error(`       Details: ${details}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Phase 1: Container Orchestration & Health
  // ---------------------------------------------------------------------------
  console.log('\n--- 1. Container Orchestration & Health Status ---');
  const psOutput = run('docker compose ps --format json');
  assertTest('All 4 core services are running in Docker', psOutput.includes('nexpanel-web') && psOutput.includes('nexpanel-db') && psOutput.includes('npm') && psOutput.includes('nexpanel-mysql'));

  const healthRes = await fetchJson(`${PANEL_URL}/health`);
  assertTest('Panel health endpoint (GET /health) returns status: ok', healthRes.ok && healthRes.data?.status === 'ok', `App: ${healthRes.data?.app} v${healthRes.data?.version}`);

  const readyRes = await fetchJson(`${PANEL_URL}/health/ready`);
  assertTest('Panel readiness endpoint (GET /health/ready) verifies DB & Vault', readyRes.ok && readyRes.data?.status === 'ready' && readyRes.data?.checks?.database?.ok, `Checks: ${JSON.stringify(readyRes.data?.checks)}`);

  // ---------------------------------------------------------------------------
  // Phase 2: Frontend SPA & Static Asset Serving
  // ---------------------------------------------------------------------------
  console.log('\n--- 2. Frontend SPA & Static Asset Serving ---');
  const spaRes = await fetch(`${PANEL_URL}/`);
  const spaHtml = await spaRes.text();
  assertTest('Panel root (GET /) serves built React frontend HTML', spaRes.status === 200 && spaHtml.includes('<title>NexPanel') && spaHtml.includes('/assets/index-'), `HTML Length: ${spaHtml.length} bytes`);

  const spaNavRes = await fetch(`${PANEL_URL}/admin/database-engines`);
  const spaNavHtml = await spaNavRes.text();
  assertTest('SPA client routing fallback serves index.html for client paths', spaNavRes.status === 200 && spaNavHtml.includes('<title>NexPanel'));

  const docsRes = await fetch(`${PANEL_URL}/docs/`);
  assertTest('Swagger OpenAPI documentation UI is accessible at /docs/', docsRes.status === 200);

  // ---------------------------------------------------------------------------
  // Phase 3: Metadata PostgreSQL & MySQL Engine Connectivity
  // ---------------------------------------------------------------------------
  console.log('\n--- 3. Database Engines (PostgreSQL 16 & MySQL 8.4) ---');
  const psqlTables = run('docker exec nexpanel-db psql -U nexpanel -d nexpanel -c "\\dt"');
  assertTest('PostgreSQL panel metadata DB initialized all core tables', psqlTables.includes('users') && psqlTables.includes('sites') && psqlTables.includes('proxy_hosts') && psqlTables.includes('databases'));

  const mysqlDb = run('docker exec nexpanel-mysql mysql -uroot -pInternalMySQL_Root_2026! -e "SHOW DATABASES;"');
  assertTest('Internal MySQL 8.4 engine is alive on sites network', mysqlDb.includes('information_schema') && mysqlDb.includes('mysql'));

  // ---------------------------------------------------------------------------
  // Phase 4: Auth & First Admin Setup Lifecycle
  // ---------------------------------------------------------------------------
  console.log('\n--- 4. Auth & First Admin Setup Lifecycle ---');
  const setupStatusRes = await fetchJson(`${PANEL_URL}/api/v1/auth/setup-status`);
  assertTest('Panel setup-status endpoint checks setup window', setupStatusRes.ok);

  let authToken = '';
  if (setupStatusRes.data?.setupRequired) {
    const setupRes = await fetchJson(`${PANEL_URL}/api/v1/auth/setup`, {
      method: 'POST',
      body: JSON.stringify({
        username: 'admin',
        email: 'admin@nexpanel.local',
        password: 'SuperAdminSecret2026!'
      })
    });
    assertTest('First administrator registered via POST /api/v1/auth/setup', setupRes.ok, `Admin ID: ${setupRes.data?.user?.id}`);
    authToken = setupRes.data?.tokens?.accessToken;
  } else {
    // Already setup, login
    const loginRes = await fetchJson(`${PANEL_URL}/api/v1/auth/login`, {
      method: 'POST',
      body: JSON.stringify({
        identifier: 'admin',
        password: 'SuperAdminSecret2026!'
      })
    });
    assertTest('Admin login via POST /api/v1/auth/login succeeded', loginRes.ok);
    authToken = loginRes.data?.tokens?.accessToken;
  }

  assertTest('Valid JWT access token obtained for authenticated API calls', Boolean(authToken));

  const meRes = await fetchJson(`${PANEL_URL}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${authToken}` }
  });
  assertTest('Authenticated GET /api/v1/auth/me returns admin identity', meRes.ok && meRes.data?.user?.role === 'admin', `User: ${meRes.data?.user?.username} (${meRes.data?.user?.email})`);

  // ---------------------------------------------------------------------------
  // Phase 5: External NPM Collaboration (Rule R1)
  // ---------------------------------------------------------------------------
  console.log('\n--- 5. External NPM Collaboration & Reverse Proxy (Rule R1) ---');
  
  // 5.1 Ensure Edge Provider exists
  const listProvRes = await fetchJson(`${PANEL_URL}/api/v1/edge/providers`, {
    headers: { Authorization: `Bearer ${authToken}` }
  });
  
  let providerId = listProvRes.data?.data?.[0]?.id;
  if (!providerId) {
    const configProvRes = await fetchJson(`${PANEL_URL}/api/v1/edge/providers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        name: 'Nginx Proxy Manager Lab',
        baseUrl: 'http://npm:81',
        adminEmail: 'admin@example.com',
        adminPassword: 'changeme',
        networkName: 'proxy'
      })
    });
    providerId = configProvRes.data?.id;
  }
  assertTest('NPM Edge Provider configured in NexPanel with credentials in Vault', Boolean(providerId), `Provider ID: ${providerId}`);

  // 5.2 Test Edge Provider Connection to NPM API over Docker proxy network
  const testConnRes = await fetchJson(`${PANEL_URL}/api/v1/edge/providers/${providerId}/test`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}` }
  });
  assertTest('NexPanel verifies connection to live NPM 2.16 API over proxy network', testConnRes.ok && testConnRes.data?.ok, `Status: ${testConnRes.status}, NPM Version: ${testConnRes.data?.version}, Data: ${JSON.stringify(testConnRes.data)}`);

  // 5.3 Rule R1: Rejection of localhost / 127.0.0.1
  const r1RejectRes = await fetchJson(`${PANEL_URL}/api/v1/edge/proxy-hosts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({
      domainNames: ['illegal-localhost.example.com'],
      forwardScheme: 'http',
      forwardHost: '127.0.0.1',
      forwardPort: 8080
    })
  });
  assertTest('Rule R1 Gate: Rejects localhost/127.0.0.1 forward host with guidance', r1RejectRes.status === 400 && JSON.stringify(r1RejectRes.data).includes('resolves to NPM container itself'), `Response: ${r1RejectRes.data?.error?.message}`);

  // 5.4 Create live proxy host routing through NPM to nexpanel-web:8443
  const testDomain = `docker-test-${Date.now()}.nexpanel.local`;
  const createHostRes = await fetchJson(`${PANEL_URL}/api/v1/edge/proxy-hosts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({
      domainNames: [testDomain],
      forwardScheme: 'http',
      forwardHost: 'nexpanel-web',
      forwardPort: 8443,
      websocket: true
    })
  });
  const createdHost = createHostRes.data?.proxyHost;
  assertTest('NPM provisions proxy host for domain routing to nexpanel-web:8443', createHostRes.ok && createdHost?.edgeHostId > 0, `NPM Edge Host ID: ${createdHost?.edgeHostId}, Panel ID: ${createdHost?.id}`);

  // Wait for OpenResty reload in NPM
  await new Promise(r => setTimeout(r, 1200));

  // 5.5 Verify reverse proxy routing end-to-end through port 80 owned by NPM
  const routedReq = await requestHttp({
    host: '127.0.0.1',
    port: 80,
    path: '/health',
    headers: {
      Host: testDomain
    }
  });
  assertTest('End-to-End NPM Routing: Port 80 HTTP traffic routes to nexpanel-web through NPM', routedReq.statusCode === 200 && routedReq.body.includes('"status":"ok"'), `Status: ${routedReq.statusCode}, Body: ${routedReq.body.trim()}`);

  // 5.6 Test Drift Detection
  const driftRes = await fetchJson(`${PANEL_URL}/api/v1/edge/providers/${providerId}/reconcile`, {
    headers: { Authorization: `Bearer ${authToken}` }
  });
  assertTest('Drift Reconciler inspects NPM hosts against panel desired state', driftRes.ok && Array.isArray(driftRes.data?.report?.items), `Drift items checked: ${driftRes.data?.report?.items?.length || 0}`);

  // 5.7 Clean up test proxy host
  if (createdHost?.id) {
    const delRes = await fetchJson(`${PANEL_URL}/api/v1/edge/proxy-hosts/${createdHost.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` }
    });
    assertTest('Proxy host cleanly deleted from NexPanel and NPM', delRes.ok, `Status: ${delRes.status}, Data: ${JSON.stringify(delRes.data)}`);
  }

  // ---------------------------------------------------------------------------
  // Phase 6: Sites Management Lifecycle
  // ---------------------------------------------------------------------------
  console.log('\n--- 6. Sites Lifecycle Management ---');
  const siteDomain = `site-${Date.now()}.local`;
  const createSiteRes = await fetchJson(`${PANEL_URL}/api/v1/sites`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({
      domain: siteDomain,
      type: 'php',
      phpVersion: '8.3'
    })
  });
  assertTest('Site creation API creates PHP 8.3 site record', createSiteRes.ok && createSiteRes.data?.site?.id, `Site ID: ${createSiteRes.data?.site?.id}`);
  const siteId = createSiteRes.data?.site?.id;

  const listSitesRes = await fetchJson(`${PANEL_URL}/api/v1/sites`, {
    headers: { Authorization: `Bearer ${authToken}` }
  });
  assertTest('GET /api/v1/sites includes the newly provisioned site', listSitesRes.ok && listSitesRes.data?.data?.some((s: any) => s.domain === siteDomain));

  if (siteId) {
    const delSiteRes = await fetchJson(`${PANEL_URL}/api/v1/sites/${siteId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ confirmDomain: siteDomain })
    });
    assertTest('Site soft-deleted with domain confirmation', delSiteRes.ok);
  }

  // ---------------------------------------------------------------------------
  // Phase 7: nxctl CLI In-Container Execution
  // ---------------------------------------------------------------------------
  console.log('\n--- 7. nxctl CLI In-Container Execution ---');
  const cliHealthOutput = run('docker exec nexpanel-web nxctl health --json');
  assertTest('nxctl health --json inside container executes successfully', cliHealthOutput.includes('"status": "ok"') && cliHealthOutput.includes('"status": "ready"'));

  const cliUserOutput = run(`docker exec nexpanel-web nxctl user:list --token ${authToken} --json`);
  assertTest('nxctl user:list --json returns administrative users', cliUserOutput.includes('admin@nexpanel.local'));

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`   Verification Complete: ${passed} / ${total} Tests Passed (${Math.round((passed / total) * 100)}%)`);
  console.log('================================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
