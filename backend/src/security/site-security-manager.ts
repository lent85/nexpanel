import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDb } from '../db/index.js';
import { AuditService } from '../audit/audit.js';
import { SiteService } from '../sites/site-service.js';
import { SiteSecurityRule, SiteSecurityRuleType } from './types.js';

export const CLOUDFLARE_IPV4_BLOCKS = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22'
];

export const CLOUDFLARE_IPV6_BLOCKS = [
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32'
];

export const COMMON_BAD_BOTS = [
  'ahrefs',
  'semrush',
  'mj12bot',
  'dotbot',
  'petalbot',
  'rogerbot',
  'megaindex',
  'blexbot',
  'zoominfobot'
];

export class SiteSecurityManager {
  public static async listRules(siteId: string): Promise<SiteSecurityRule[]> {
    const db = getDb();
    const res = await db.query<SiteSecurityRule>(
      'SELECT * FROM site_security_rules WHERE site_id = $1 ORDER BY created_at ASC',
      [siteId]
    );
    return res.rows;
  }

  public static async addRule(
    siteId: string,
    ruleType: SiteSecurityRuleType,
    target: string,
    valueJson?: Record<string, unknown>,
    actorUserId?: string,
    actorIp?: string
  ): Promise<SiteSecurityRule> {
    const site = await SiteService.getSiteById(siteId);
    if (!site) {
      throw new Error(`Site '${siteId}' not found`);
    }

    const db = getDb();
    const id = randomUUID();
    const now = new Date().toISOString();

    const rule: SiteSecurityRule = {
      id,
      site_id: siteId,
      rule_type: ruleType,
      target: target.trim(),
      value_json: valueJson ? JSON.stringify(valueJson) : undefined,
      enabled: true,
      created_at: now,
      updated_at: now
    };

    await db.execute(
      `INSERT INTO site_security_rules (
        id, site_id, rule_type, target, value_json, enabled, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, siteId, ruleType, rule.target, rule.value_json || null, true, now, now]
    );

    // Re-generate security Nginx snippet for site
    await this.applyRulesToSite(siteId);

    await AuditService.log({
      action: 'site_security:rule_add',
      actorUserId,
      actorIp,
      entityType: 'site_security_rule',
      entityId: id,
      after: { domain: site.domain, ruleType, target }
    });

    return rule;
  }

  public static async deleteRule(
    siteId: string,
    ruleId: string,
    actorUserId?: string,
    actorIp?: string
  ): Promise<void> {
    const db = getDb();
    const res = await db.query<SiteSecurityRule>(
      'SELECT * FROM site_security_rules WHERE id = $1 AND site_id = $2',
      [ruleId, siteId]
    );
    const rule = res.rows[0];
    if (!rule) {
      throw new Error(`Security rule '${ruleId}' not found for site`);
    }

    await db.execute('DELETE FROM site_security_rules WHERE id = $1', [ruleId]);

    // Re-generate security snippet
    await this.applyRulesToSite(siteId);

    await AuditService.log({
      action: 'site_security:rule_delete',
      actorUserId,
      actorIp,
      entityType: 'site_security_rule',
      entityId: ruleId,
      after: { ruleType: rule.rule_type, target: rule.target }
    });
  }

  /**
   * Generates Nginx security configuration snippet for a site.
   */
  public static async generateNginxSecuritySnippet(siteId: string): Promise<string> {
    const rules = await this.listRules(siteId);
    let snippet = `# NexPanel Security Rules for Site\n`;

    // 1. IP Blocks
    const ipBlocks = rules.filter((r) => r.rule_type === 'ip_block' && r.enabled);
    if (ipBlocks.length > 0) {
      snippet += `\n# IP Blocks\n`;
      for (const ip of ipBlocks) {
        snippet += `deny ${ip.target};\n`;
      }
    }

    // 2. Bot Blocks
    const botBlocks = rules.filter((r) => r.rule_type === 'bot_block' && r.enabled);
    if (botBlocks.length > 0) {
      const bots = botBlocks.map((b) => b.target.toLowerCase()).join('|');
      snippet += `\n# Bot Blocks\n`;
      snippet += `if ($http_user_agent ~* (${bots})) {\n    return 403 "Forbidden bot";\n}\n`;
    }

    // 3. Cloudflare-only Mode
    const cfOnly = rules.find((r) => r.rule_type === 'cloudflare_only' && r.enabled);
    if (cfOnly) {
      snippet += `\n# Cloudflare-Only Mode (Deny direct IP requests)\n`;
      for (const cidr of CLOUDFLARE_IPV4_BLOCKS) {
        snippet += `set_real_ip_from ${cidr};\nallow ${cidr};\n`;
      }
      for (const cidr of CLOUDFLARE_IPV6_BLOCKS) {
        snippet += `set_real_ip_from ${cidr};\nallow ${cidr};\n`;
      }
      snippet += `real_ip_header CF-Connecting-IP;\ndeny all;\n`;
    }

    // 4. Security Headers Presets
    const secHeaders = rules.find((r) => r.rule_type === 'security_headers' && r.enabled);
    if (secHeaders) {
      snippet += `\n# Security Headers\n`;
      snippet += `add_header X-Content-Type-Options "nosniff" always;\n`;
      snippet += `add_header X-Frame-Options "SAMEORIGIN" always;\n`;
      snippet += `add_header Referrer-Policy "strict-origin-when-cross-origin" always;\n`;
      snippet += `add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;\n`;
    }

    return snippet;
  }

  /**
   * Writes the security snippet into the site's conf directory.
   */
  public static async applyRulesToSite(siteId: string): Promise<string> {
    const site = await SiteService.getSiteById(siteId);
    if (!site) return '';

    const snippet = await this.generateNginxSecuritySnippet(siteId);
    const confPath = path.resolve(site.volumePath, 'conf', 'security.conf');
    fs.mkdirSync(path.dirname(confPath), { recursive: true });
    fs.writeFileSync(confPath, snippet);
    return snippet;
  }
}
