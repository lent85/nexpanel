import { v7 as uuidv7 } from 'uuid';
import { AuthService } from '../auth/auth-service.js';
import { brand } from '../config/brand.js';
import { getEnv } from '../config/env.js';
import { DbProvisioner } from '../db-engines/db-provisioner.js';
import { EngineRegistry } from '../db-engines/engine-registry.js';
import { CreateSiteInput, SiteService } from '../sites/site-service.js';
import { getDb } from './index.js';
import { Site, User, UserRole } from './types.js';

export interface SeedResult {
  admin: {
    username: string;
    email: string;
    passwordDisplay: string;
    isNew: boolean;
  };
  engine: {
    id: string;
    name: string;
    type: string;
  };
  database?: {
    name: string;
    username: string;
    passwordDisplay: string;
    isNew: boolean;
  };
  sites: Array<{
    id?: string;
    domain: string;
    type: string;
    status: string;
    isNew: boolean;
  }>;
  demoUsers?: Array<{
    username: string;
    email: string;
    role: string;
    passwordDisplay: string;
    assignedDomains: string[];
  }>;
}

export class Seeder {
  public static async seed(): Promise<SeedResult> {
    const env = getEnv();
    const db = getDb();

    console.log(`[Seeder] Preparing ${brand.name} database and initial seed data...`);

    // 1. Ensure migrations are applied
    await db.migrate();

    // 2. Initialize default database engine (MySQL 8.4 internal container record)
    await EngineRegistry.initDefaultEngines();
    const defaultEngine = await EngineRegistry.getDefaultEngine();

    // 3. Ensure administrator account exists
    let adminUsername = 'admin';
    let adminEmail = 'admin@nexpanel.local';
    let adminPassword = 'AdminPassword123!';
    let isNewAdmin = false;
    let adminUserId: string;

    const existingUsers = await db.query<User>('SELECT * FROM users WHERE role = $1 ORDER BY created_at ASC LIMIT 1', ['admin']);
    if (existingUsers.rows.length === 0) {
      const isSetup = await AuthService.isSetupMode();
      if (isSetup) {
        const adminRes = await AuthService.registerFirstAdmin({
          email: adminEmail,
          username: adminUsername,
          password: adminPassword,
          ip: '127.0.0.1'
        });
        adminUserId = adminRes.user.id;
      } else {
        const adminRes = await AuthService.createUser({
          email: adminEmail,
          username: adminUsername,
          password: adminPassword,
          role: 'admin',
          ip: '127.0.0.1'
        });
        adminUserId = adminRes.user.id;
      }
      isNewAdmin = true;
      console.log(`[Seeder] Created default administrator: ${adminUsername} (${adminEmail})`);
    } else {
      const existing = existingUsers.rows[0];
      adminUserId = existing.id;
      adminUsername = existing.username;
      adminEmail = existing.email;
      adminPassword = '(existing password unchanged)';
      console.log(`[Seeder] Administrator account already exists: ${adminUsername} (${adminEmail})`);
    }

    // 4. Ensure sample database & user exist
    const sampleDbName = 'sample_app_db';
    const sampleDbUser = 'sample_app_user';
    const sampleDbPass = 'SampleAppDbPass123!';
    let isNewDb = false;

    const existingDb = await db.query(
      'SELECT id FROM databases WHERE engine_id = $1 AND name = $2 AND deleted_at IS NULL',
      [defaultEngine.id, sampleDbName]
    );

    if (existingDb.rows.length === 0) {
      try {
        await DbProvisioner.createDatabaseAndUser(
          {
            engineId: defaultEngine.id,
            name: sampleDbName,
            user: {
              username: sampleDbUser,
              password: sampleDbPass,
              privileges: 'read_write'
            }
          },
          adminUserId,
          '127.0.0.1'
        );
        isNewDb = true;
        console.log(`[Seeder] Created sample database '${sampleDbName}' with user '${sampleDbUser}'`);
      } catch (err: any) {
        console.warn(`[Seeder] Note on sample database provisioning: ${err.message}`);
      }
    } else {
      console.log(`[Seeder] Sample database '${sampleDbName}' already exists.`);
    }

    // 5. Seed sample sites across different runtimes
    const sampleSiteConfigs: Array<{
      input: CreateSiteInput;
      description: string;
    }> = [
      {
        description: 'WordPress 6.x / PHP 8.3 CMS Demo',
        input: {
          domain: 'wordpress.example.local',
          aliases: ['www.wordpress.example.local'],
          type: 'wordpress',
          phpVersion: '8.3',
          tags: ['demo', 'wordpress', 'cms'],
          notes: 'Pre-seeded WordPress demo site on PHP 8.3',
          wordpress: {
            siteTitle: 'NexPanel WordPress Demo',
            adminUsername: 'wpadmin',
            adminPassword: 'WpAdminPassword123!',
            adminEmail: 'wpadmin@example.local',
            dbName: 'wp_demo',
            dbUser: 'wp_demo_user',
            dbPassword: 'WpDemoPassword123!',
            dbHost: defaultEngine.container_name || 'nexpanel-mysql-8.4'
          }
        }
      },
      {
        description: 'Node.js 22 High-Performance REST API',
        input: {
          domain: 'api.example.local',
          aliases: ['rest.example.local'],
          type: 'nodejs',
          nodeVersion: '22',
          tags: ['demo', 'nodejs', 'api'],
          notes: 'Pre-seeded Node.js 22 service'
        }
      },
      {
        description: 'PHP 8.3 Modern Web Application',
        input: {
          domain: 'app.example.local',
          aliases: ['www.app.example.local'],
          type: 'php',
          phpVersion: '8.3',
          tags: ['demo', 'php', 'web'],
          notes: 'Pre-seeded PHP 8.3 web application with phpinfo()'
        }
      },
      {
        description: 'Reverse Proxy to Internal Container Upstream',
        input: {
          domain: 'proxy-service.example.local',
          type: 'reverse_proxy',
          tags: ['demo', 'reverse-proxy', 'upstream'],
          notes: 'Pre-seeded reverse proxy host pointing to uptime-kuma:3001',
          reverseProxy: {
            upstreamUrl: 'http://uptime-kuma:3001',
            websocketSupport: true
          }
        }
      }
    ];

    const seededSites: SeedResult['sites'] = [];
    const siteDomainMap = new Map<string, string>(); // domain -> id

    for (const siteDef of sampleSiteConfigs) {
      const domain = siteDef.input.domain;
      const existingSite = await db.query<Site>(
        'SELECT id, domain, type, status FROM sites WHERE domain = $1 AND deleted_at IS NULL',
        [domain]
      );

      if (existingSite.rows.length === 0) {
        try {
          const site = await SiteService.createSite(
            {
              ...siteDef.input,
              ownerUserId: adminUserId
            },
            adminUserId,
            '127.0.0.1'
          );
          siteDomainMap.set(domain, site.id);
          seededSites.push({
            id: site.id,
            domain: site.domain,
            type: site.type,
            status: site.status,
            isNew: true
          });
          console.log(`[Seeder] Seeded site: ${domain} [${siteDef.input.type}] (${siteDef.description})`);
        } catch (err: any) {
          console.warn(`[Seeder] Warning creating site ${domain}: ${err.message}`);
        }
      } else {
        const s = existingSite.rows[0];
        siteDomainMap.set(domain, s.id);
        seededSites.push({
          id: s.id,
          domain: s.domain,
          type: s.type,
          status: s.status,
          isNew: false
        });
        console.log(`[Seeder] Site '${domain}' already exists.`);
      }
    }

    // 6. Seed Demo Users for Multi-User RBAC & Site Scoping
    const demoUsersToSeed: Array<{
      username: string;
      email: string;
      password: string;
      role: UserRole;
      assignedDomains: string[];
    }> = [
      {
        username: 'manager',
        email: 'manager@nexpanel.local',
        password: 'ManagerPassword123!',
        role: 'site_manager',
        assignedDomains: [] // site_manager has global access to all sites
      },
      {
        username: 'developer',
        email: 'dev@nexpanel.local',
        password: 'DeveloperPassword123!',
        role: 'user',
        assignedDomains: ['api.example.local', 'app.example.local']
      },
      {
        username: 'client',
        email: 'client@nexpanel.local',
        password: 'ClientPassword123!',
        role: 'client',
        assignedDomains: ['wordpress.example.local']
      }
    ];

    const seededDemoUsers: SeedResult['demoUsers'] = [];

    for (const u of demoUsersToSeed) {
      let userId: string;
      const userCheck = await db.query<User>('SELECT id FROM users WHERE username = $1', [u.username]);

      if (userCheck.rows.length === 0) {
        try {
          const created = await AuthService.createUser({
            email: u.email,
            username: u.username,
            password: u.password,
            role: u.role,
            ip: '127.0.0.1'
          });
          userId = created.user.id;
          console.log(`[Seeder] Created demo user: ${u.username} (${u.role})`);
        } catch (err: any) {
          console.warn(`[Seeder] Warning creating demo user ${u.username}: ${err.message}`);
          continue;
        }
      } else {
        userId = userCheck.rows[0].id;
      }

      // Assign sites if any
      const now = new Date().toISOString();
      for (const dom of u.assignedDomains) {
        const sId = siteDomainMap.get(dom);
        if (sId) {
          const existingAssign = await db.query(
            'SELECT id FROM site_assignments WHERE user_id = $1 AND site_id = $2',
            [userId, sId]
          );
          if (existingAssign.rows.length === 0) {
            await db.execute(
              'INSERT INTO site_assignments (id, user_id, site_id, created_at) VALUES ($1, $2, $3, $4)',
              [uuidv7(), userId, sId, now]
            );
          }
        }
      }

      seededDemoUsers.push({
        username: u.username,
        email: u.email,
        role: u.role,
        passwordDisplay: u.password,
        assignedDomains: u.assignedDomains
      });
    }

    const result: SeedResult = {
      admin: {
        username: adminUsername,
        email: adminEmail,
        passwordDisplay: adminPassword,
        isNew: isNewAdmin
      },
      engine: {
        id: defaultEngine.id,
        name: defaultEngine.name,
        type: defaultEngine.type
      },
      database: {
        name: sampleDbName,
        username: sampleDbUser,
        passwordDisplay: isNewDb ? sampleDbPass : '(existing password unchanged)',
        isNew: isNewDb
      },
      sites: seededSites,
      demoUsers: seededDemoUsers
    };

    // Print summary banner
    Seeder.printBanner(result, env.PANEL_HOST, env.PANEL_PORT);

    return result;
  }

  public static printBanner(res: SeedResult, host: string, port: number): void {
    const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host;
    const line = '='.repeat(68);
    const subLine = '-'.repeat(68);

    console.log(`\n${line}`);
    console.log(`               NexPanel Local Development Seeding               `);
    console.log(line);
    console.log(`  Admin Dashboard URL: http://${displayHost}:${port}`);
    console.log(`  Super Admin:         ${res.admin.username} (${res.admin.email}) / ${res.admin.passwordDisplay}`);
    if (res.demoUsers && res.demoUsers.length > 0) {
      console.log(subLine);
      console.log('  RBAC Role Presets:');
      for (const u of res.demoUsers) {
        const scope = u.assignedDomains.length > 0 ? `[Scoped: ${u.assignedDomains.join(', ')}]` : '[All Sites]';
        console.log(`    - ${u.username} (${u.role}): ${u.passwordDisplay} ${scope}`);
      }
    }
    console.log(subLine);
    console.log(`  Database Engine:     ${res.engine.name} (${res.engine.type})`);
    if (res.database) {
      console.log(`  Sample Database:     ${res.database.name}`);
      console.log(`  Database User:       ${res.database.username} / ${res.database.passwordDisplay}`);
    }
    console.log(subLine);
    console.log('  Configured Sites:');
    for (const site of res.sites) {
      console.log(`    * http://${site.domain} [${site.type.toUpperCase()}] (Status: ${site.status})`);
    }
    console.log(`${line}\n`);
  }
}

// Auto-run if executed as standalone script
if (process.argv[1] && (process.argv[1].endsWith('seeder.ts') || process.argv[1].endsWith('seeder.js'))) {
  Seeder.seed()
    .then(() => {
      console.log('[Seeder] Seeding process completed successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Seeder] Fatal error during seeding:', err);
      process.exit(1);
    });
}
