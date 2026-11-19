import { v7 as uuidv7 } from 'uuid';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDb } from '../db/index.js';
import { Site, SiteType, SiteStatus } from '../db/types.js';
import { getEnv } from '../config/env.js';
import { VhostManager } from './vhost-manager.js';
import { PhpManager } from './php-manager.js';
import { WordPressScaffolder, WordPressInstallParams } from './wordpress-scaffolder.js';
import { AuditService } from '../audit/audit.js';
import { ContainerRunner } from './container-runner.js';
import { NpmEdgeProvider } from '../edge/npm-provider.js';
import { ProxyQueue } from '../edge/proxy-queue.js';

export interface CreateSiteInput {
  domain: string;
  aliases?: string[];
  type: SiteType;
  phpVersion?: string;
  nodeVersion?: string;
  pythonVersion?: string;
  documentRoot?: string;
  dbEngineId?: string;
  varnishEnabled?: boolean;
  redisEnabled?: boolean;
  tags?: string[];
  notes?: string;
  ownerUserId?: string;
  wordpress?: {
    siteTitle: string;
    adminUsername: string;
    adminPassword?: string;
    adminEmail: string;
    dbName?: string;
    dbUser?: string;
    dbPassword?: string;
    dbHost?: string;
  };
  reverseProxy?: {
    upstreamUrl: string;
    websocketSupport?: boolean;
  };
}

export class SiteService {
  public static slugifyDomain(domain: string): string {
    return domain.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  }

  public static getSitePaths(slug: string) {
    const env = getEnv();
    const siteRoot = path.resolve(env.SITES_DATA_DIR, slug);
    return {
      siteRoot,
      htdocs: path.resolve(siteRoot, 'htdocs'),
      logs: path.resolve(siteRoot, 'logs'),
      backups: path.resolve(siteRoot, 'backups'),
      conf: path.resolve(siteRoot, 'conf')
    };
  }

  public static async createSite(input: CreateSiteInput, actorUserId?: string, actorIp?: string): Promise<Site> {
    const db = getDb();
    const domain = input.domain.trim().toLowerCase();

    // Check unique domain
    const existing = await db.query<Site>('SELECT id FROM sites WHERE domain = $1 AND deleted_at IS NULL', [domain]);
    if (existing.rows.length > 0) {
      const err = new Error(`Site with domain '${domain}' already exists`);
      (err as any).statusCode = 409;
      throw err;
    }

    const slug = SiteService.slugifyDomain(domain);
    const paths = SiteService.getSitePaths(slug);

    // Create directories
    for (const dir of Object.values(paths)) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    const id = uuidv7();
    const now = new Date().toISOString();
    const phpVersion = input.type === 'wordpress' || input.type === 'php' ? input.phpVersion || '8.3' : undefined;
    const originPort = input.type === 'reverse_proxy' ? 0 : 8080;
    const docRoot = input.documentRoot || paths.htdocs;

    // Origin container names per docs/03 §3.5
    const originContainerName = `site-${slug}-web`;

    // 1. Scaffold files based on type
    if (input.type === 'wordpress') {
      const wp = input.wordpress || {
        siteTitle: 'My WordPress Site',
        adminUsername: 'admin',
        adminEmail: 'admin@' + domain
      };
      WordPressScaffolder.scaffold({
        documentRoot: docRoot,
        domain,
        siteTitle: wp.siteTitle,
        adminUsername: wp.adminUsername,
        adminPassword: wp.adminPassword,
        adminEmail: wp.adminEmail,
        dbName: wp.dbName || `wp_${slug.replace(/-/g, '_').substring(0, 16)}`,
        dbUser: wp.dbUser || `u_${slug.replace(/-/g, '_').substring(0, 14)}`,
        dbPassword: wp.dbPassword,
        dbHost: wp.dbHost || 'nexpanel-mysql'
      });
    } else if (input.type === 'php') {
      const indexPhp = `<?php\nphpinfo();\n`;
      fs.writeFileSync(path.resolve(docRoot, 'index.php'), indexPhp);
    } else if (input.type === 'static') {
      const indexHtml = `<!DOCTYPE html><html><head><title>${domain}</title></head><body><h1>Welcome to ${domain}</h1><p>Served by NexPanel.</p></body></html>`;
      fs.writeFileSync(path.resolve(docRoot, 'index.html'), indexHtml);
    } else if (input.type === 'nodejs') {
      const serverJs = `const http = require('http');\nconst server = http.createServer((req, res) => { res.end('Node.js app running on NexPanel'); });\nserver.listen(3000);`;
      fs.writeFileSync(path.resolve(docRoot, 'server.js'), serverJs);
    } else if (input.type === 'python') {
      const appPy = `def application(environ, start_response):\n    start_response('200 OK', [('Content-Type', 'text/html')])\n    return [b'Python WSGI app running on NexPanel']\n`;
      fs.writeFileSync(path.resolve(docRoot, 'wsgi.py'), appPy);
    }

    // 2. Generate vhost file
    const templateName = input.type === 'wordpress' ? 'wordpress' : input.type === 'static' ? 'static' : input.type === 'reverse_proxy' ? 'reverse_proxy' : 'php';
    const vhostContent = VhostManager.renderVhost(templateName, {
      domain,
      aliases: input.aliases,
      documentRoot: docRoot,
      phpVersion,
      upstreamUrl: input.reverseProxy?.upstreamUrl
    });

    const vhostPath = path.resolve(paths.conf, `${domain}.conf`);
    fs.writeFileSync(vhostPath, vhostContent);

    // 3. Write PHP settings if applicable
    if (phpVersion) {
      const phpIniPath = path.resolve(paths.conf, 'php.ini');
      fs.writeFileSync(phpIniPath, PhpManager.renderPhpIni());
    }

    // 4. Start origin container
    const originRes = await ContainerRunner.startSiteOrigin({
      id,
      domain,
      aliases: input.aliases || [],
      type: input.type,
      status: 'provisioning',
      phpVersion,
      nodeVersion: input.nodeVersion,
      pythonVersion: input.pythonVersion,
      documentRoot: docRoot,
      siteUserUid: 1001,
      volumePath: paths.siteRoot,
      originContainerName,
      originPort,
      dbEngineId: input.dbEngineId,
      varnishEnabled: Boolean(input.varnishEnabled),
      redisEnabled: Boolean(input.redisEnabled),
      maintenanceMode: false,
      tags: input.tags || [],
      notes: input.notes,
      ownerUserId: input.ownerUserId,
      hostId: 'host-1',
      createdAt: now,
      updatedAt: now
    });

    // 5. Register proxy host with NPM (FR-PROXY-01, R1)
    let edgeHostId: number | null = null;
    let proxyStatus: 'in_sync' | 'drifted' = 'in_sync';

    try {
      const provider = await NpmEdgeProvider.getDefault();
      const check = await provider.verifyConnection();
      if (check.ok) {
        const proxyRes = await provider.createHost({
          domainNames: [domain, ...(input.aliases || [])],
          forwardScheme: 'http',
          forwardHost: originContainerName,
          forwardPort: originPort,
          http2Support: true,
          websocketSupport: true,
          enabled: true
        });
        edgeHostId = proxyRes.edgeId;
      } else {
        proxyStatus = 'drifted';
        ProxyQueue.enqueue({
          action: 'create',
          payload: {
            domainNames: [domain, ...(input.aliases || [])],
            forwardScheme: 'http',
            forwardHost: originContainerName,
            forwardPort: originPort,
            http2Support: true,
            websocketSupport: true,
            enabled: true
          }
        });
      }
    } catch {
      proxyStatus = 'drifted';
      ProxyQueue.enqueue({
        action: 'create',
        payload: {
          domainNames: [domain, ...(input.aliases || [])],
          forwardScheme: 'http',
          forwardHost: originContainerName,
          forwardPort: originPort,
          http2Support: true,
          websocketSupport: true,
          enabled: true
        }
      });
    }

    const siteStatus: SiteStatus = originRes.started ? 'live' : 'provisioning';

    const site: Site = {
      id,
      domain,
      aliases: input.aliases || [],
      type: input.type,
      status: siteStatus,
      phpVersion,
      nodeVersion: input.nodeVersion,
      pythonVersion: input.pythonVersion,
      documentRoot: docRoot,
      siteUserUid: 1001,
      volumePath: paths.siteRoot,
      originContainerName,
      originPort,
      dbEngineId: input.dbEngineId,
      varnishEnabled: Boolean(input.varnishEnabled),
      redisEnabled: Boolean(input.redisEnabled),
      maintenanceMode: false,
      tags: input.tags || [],
      notes: input.notes,
      ownerUserId: input.ownerUserId,
      hostId: 'host-1',
      createdAt: now,
      updatedAt: now
    };

    await db.execute(
      `INSERT INTO sites (id, domain, aliases, type, status, php_version, node_version, python_version, document_root, site_user_uid, volume_path, origin_container_name, origin_port, db_engine_id, varnish_enabled, redis_enabled, maintenance_mode, tags, notes, owner_user_id, host_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)`,
      [
        site.id,
        site.domain,
        site.aliases,
        site.type,
        site.status,
        site.phpVersion || null,
        site.nodeVersion || null,
        site.pythonVersion || null,
        site.documentRoot,
        site.siteUserUid,
        site.volumePath,
        site.originContainerName,
        site.originPort,
        site.dbEngineId || null,
        site.varnishEnabled,
        site.redisEnabled,
        site.maintenanceMode,
        site.tags,
        site.notes || null,
        site.ownerUserId || null,
        site.hostId,
        site.createdAt,
        site.updatedAt
      ]
    );

    // Save proxy host record (linking edge_host_id and drift status)
    const proxyHostId = uuidv7();
    try {
      await db.execute(
        `INSERT INTO proxy_hosts (id, site_id, domain_names, forward_scheme, forward_host, forward_port, edge_host_id, drift_status, enabled, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          proxyHostId,
          site.id,
          [domain, ...(input.aliases || [])],
          'http',
          originContainerName,
          originPort,
          edgeHostId,
          proxyStatus,
          true,
          now,
          now
        ]
      );
    } catch {}

    await AuditService.log({
      actorUserId,
      actorIp,
      action: 'site.create',
      entityType: 'site',
      entityId: site.id,
      after: { domain: site.domain, type: site.type, phpVersion: site.phpVersion }
    });

    return site;
  }

  public static async getSiteById(id: string): Promise<Site | null> {
    const db = getDb();
    const res = await db.query<any>('SELECT * FROM sites WHERE id = $1 AND deleted_at IS NULL', [id]);
    const r = res.rows[0];
    if (!r) return null;
    return {
      id: r.id,
      domain: r.domain,
      aliases: r.aliases || [],
      type: r.type,
      status: r.status,
      phpVersion: r.php_version || r.phpVersion,
      nodeVersion: r.node_version || r.nodeVersion,
      pythonVersion: r.python_version || r.pythonVersion,
      documentRoot: r.document_root || r.documentRoot,
      siteUserUid: r.site_user_uid || r.siteUserUid || 1001,
      volumePath: r.volume_path || r.volumePath,
      originContainerName: r.origin_container_name || r.originContainerName,
      originPort: r.origin_port || r.originPort,
      dbEngineId: r.db_engine_id || r.dbEngineId,
      varnishEnabled: r.varnish_enabled ?? r.varnishEnabled ?? false,
      redisEnabled: r.redis_enabled ?? r.redisEnabled ?? false,
      maintenanceMode: r.maintenance_mode ?? r.maintenanceMode ?? false,
      tags: r.tags || [],
      notes: r.notes,
      ownerUserId: r.owner_user_id || r.ownerUserId,
      hostId: r.host_id || r.hostId || 'host-1',
      createdAt: r.created_at || r.createdAt,
      updatedAt: r.updated_at || r.updatedAt,
      deletedAt: r.deleted_at || r.deletedAt
    };
  }

  public static async switchPhpVersion(siteId: string, newVersion: string, actorUserId?: string, actorIp?: string): Promise<Site> {
    if (!PhpManager.isSupported(newVersion)) {
      const err = new Error(`Unsupported PHP version: ${newVersion}`);
      (err as any).statusCode = 400;
      throw err;
    }

    const db = getDb();
    const res = await db.query<Site>('SELECT * FROM sites WHERE id = $1 AND deleted_at IS NULL', [siteId]);
    if (res.rows.length === 0) {
      const err = new Error('Site not found');
      (err as any).statusCode = 404;
      throw err;
    }

    const site = res.rows[0];
    const oldVersion = site.phpVersion;
    const now = new Date().toISOString();

    await db.execute('UPDATE sites SET php_version = $1, updated_at = $2 WHERE id = $3', [newVersion, now, siteId]);

    // Update vhost with new upstream pool
    const slug = SiteService.slugifyDomain(site.domain);
    const paths = SiteService.getSitePaths(slug);
    const vhostPath = path.resolve(paths.conf, `${site.domain}.conf`);

    if (fs.existsSync(vhostPath)) {
      let content = fs.readFileSync(vhostPath, 'utf8');
      content = content.replace(/fastcgi_pass\s+site-[^:]+:9000;/g, `fastcgi_pass site-${slug}-php:9000;`);
      fs.writeFileSync(vhostPath, content);
    }

    await AuditService.log({
      actorUserId,
      actorIp,
      action: 'site.php_switch',
      entityType: 'site',
      entityId: siteId,
      before: { phpVersion: oldVersion },
      after: { phpVersion: newVersion }
    });

    site.phpVersion = newVersion;
    site.updatedAt = now;
    return site;
  }

  public static async updateVhost(siteId: string, newVhostContent: string, actorUserId?: string, actorIp?: string): Promise<void> {
    // 1. Validate nginx syntax with gate (nginx -t equivalent)
    const check = VhostManager.validateNginxSyntax(newVhostContent);
    if (!check.valid) {
      const err = new Error(check.error || 'Nginx syntax validation failed');
      (err as any).statusCode = 400;
      throw err;
    }

    const db = getDb();
    const res = await db.query<Site>('SELECT * FROM sites WHERE id = $1 AND deleted_at IS NULL', [siteId]);
    if (res.rows.length === 0) {
      const err = new Error('Site not found');
      (err as any).statusCode = 404;
      throw err;
    }

    const site = res.rows[0];
    const slug = SiteService.slugifyDomain(site.domain);
    const paths = SiteService.getSitePaths(slug);
    const vhostPath = path.resolve(paths.conf, `${site.domain}.conf`);

    // Keep backup copy for rollback
    if (fs.existsSync(vhostPath)) {
      const backupPath = path.resolve(paths.conf, `${site.domain}.conf.bak`);
      fs.copyFileSync(vhostPath, backupPath);
    }

    fs.writeFileSync(vhostPath, newVhostContent);

    await AuditService.log({
      actorUserId,
      actorIp,
      action: 'site.vhost_update',
      entityType: 'site',
      entityId: siteId,
      after: { domain: site.domain }
    });
  }

  public static async softDelete(siteId: string, confirmDomain: string, actorUserId?: string, actorIp?: string): Promise<void> {
    const db = getDb();
    const res = await db.query<Site>('SELECT * FROM sites WHERE id = $1 AND deleted_at IS NULL', [siteId]);
    if (res.rows.length === 0) {
      const err = new Error('Site not found');
      (err as any).statusCode = 404;
      throw err;
    }

    const site = res.rows[0];
    if (site.domain.toLowerCase() !== confirmDomain.trim().toLowerCase()) {
      const err = new Error(`Confirmation domain '${confirmDomain}' does not match site domain '${site.domain}'`);
      (err as any).statusCode = 400;
      throw err;
    }

    const now = new Date().toISOString();
    await db.execute("UPDATE sites SET status = 'trashed', deleted_at = $1, updated_at = $1 WHERE id = $2", [now, siteId]);

    await AuditService.log({
      actorUserId,
      actorIp,
      action: 'site.delete_to_trash',
      entityType: 'site',
      entityId: siteId,
      after: { domain: site.domain, trashRetentionDays: 7 }
    });
  }

  public static async restoreFromTrash(siteId: string, actorUserId?: string, actorIp?: string): Promise<void> {
    const db = getDb();
    const res = await db.query<Site>('SELECT * FROM sites WHERE id = $1', [siteId]);
    if (res.rows.length === 0) {
      const err = new Error('Site not found');
      (err as any).statusCode = 404;
      throw err;
    }

    const now = new Date().toISOString();
    await db.execute("UPDATE sites SET status = 'live', deleted_at = NULL, updated_at = $1 WHERE id = $2", [now, siteId]);

    await AuditService.log({
      actorUserId,
      actorIp,
      action: 'site.restore_from_trash',
      entityType: 'site',
      entityId: siteId
    });
  }

  public static async purgeSite(siteId: string, actorUserId?: string, actorIp?: string): Promise<void> {
    const db = getDb();
    const res = await db.query<Site>('SELECT * FROM sites WHERE id = $1', [siteId]);
    if (res.rows.length === 0) {
      return;
    }

    const site = res.rows[0];
    if (site.originContainerName) {
      try {
        await ContainerRunner.stopSiteOrigin(site.originContainerName);
      } catch {}
    }
    const siteRoot = site.volumePath || SiteService.getSitePaths(SiteService.slugifyDomain(site.domain)).siteRoot;
    if (fs.existsSync(siteRoot)) {
      try {
        fs.rmSync(siteRoot, { recursive: true, force: true });
      } catch {}
    }

    await db.execute('DELETE FROM sites WHERE id = $1', [siteId]);

    await AuditService.log({
      actorUserId,
      actorIp,
      action: 'site.purge',
      entityType: 'site',
      entityId: siteId,
      after: { domain: site.domain }
    });
  }
}
