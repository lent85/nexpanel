import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import { AuditService } from '../audit/audit.js';
import { CreateFirewallRuleInput, DockerPortWarning, FirewallRule } from './types.js';

export class FirewallManager {
  /**
   * Initializes default host firewall rules (SSH, HTTP, HTTPS, Panel).
   */
  public static async initDefaultRules(): Promise<void> {
    const db = getDb();
    const existing = await db.query<FirewallRule>('SELECT id FROM firewall_rules LIMIT 1');
    if (existing.rows.length > 0) {
      return;
    }

    const presets = [
      { port: '22', protocol: 'tcp', desc: 'SSH remote management', isSystem: true },
      { port: '80', protocol: 'tcp', desc: 'HTTP web traffic (NPM)', isSystem: true },
      { port: '443', protocol: 'tcp', desc: 'HTTPS web traffic (NPM)', isSystem: true },
      { port: '8443', protocol: 'tcp', desc: 'NexPanel Web Admin', isSystem: true }
    ];

    const now = new Date().toISOString();
    for (const p of presets) {
      const id = randomUUID();
      await db.execute(
        `INSERT INTO firewall_rules (
          id, direction, action, port, protocol, source_ip, description, is_system, status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [id, 'inbound', 'allow', p.port, p.protocol, 'any', p.desc, p.isSystem, 'applied', now, now]
      );
    }
  }

  public static async listRules(): Promise<FirewallRule[]> {
    const db = getDb();
    const res = await db.query<FirewallRule>('SELECT * FROM firewall_rules ORDER BY is_system DESC, port ASC');
    return res.rows;
  }

  public static async addRule(
    input: CreateFirewallRuleInput,
    actorUserId?: string,
    actorIp?: string
  ): Promise<FirewallRule> {
    const db = getDb();
    const id = randomUUID();
    const now = new Date().toISOString();

    const direction = input.direction || 'inbound';
    const protocol = input.protocol || 'tcp';
    const sourceIp = input.sourceIp?.trim() || 'any';

    const rule: FirewallRule = {
      id,
      direction,
      action: input.action,
      port: input.port.trim(),
      protocol,
      source_ip: sourceIp,
      description: input.description,
      is_system: false,
      status: 'applied',
      created_at: now,
      updated_at: now
    };

    await db.execute(
      `INSERT INTO firewall_rules (
        id, direction, action, port, protocol, source_ip, description, is_system, status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        rule.direction,
        rule.action,
        rule.port,
        rule.protocol,
        rule.source_ip,
        rule.description || null,
        false,
        'applied',
        now,
        now
      ]
    );

    await AuditService.log({
      action: 'firewall:rule_add',
      actorUserId,
      actorIp,
      entityType: 'firewall_rule',
      entityId: id,
      after: { port: rule.port, action: rule.action, sourceIp: rule.source_ip, protocol: rule.protocol }
    });

    return rule;
  }

  public static async deleteRule(id: string, actorUserId?: string, actorIp?: string): Promise<void> {
    const db = getDb();
    const res = await db.query<FirewallRule>('SELECT * FROM firewall_rules WHERE id = $1', [id]);
    const rule = res.rows[0];
    if (!rule) {
      throw new Error(`Firewall rule '${id}' not found`);
    }

    if (rule.is_system) {
      throw new Error(`Cannot delete system firewall rule for port ${rule.port} (${rule.description})`);
    }

    await db.execute('DELETE FROM firewall_rules WHERE id = $1', [id]);

    await AuditService.log({
      action: 'firewall:rule_delete',
      actorUserId,
      actorIp,
      entityType: 'firewall_rule',
      entityId: id,
      after: { port: rule.port, action: rule.action }
    });
  }

  /**
   * Docker-aware port inspection (NFR-SEC-08, FR-SEC-03).
   * Docker bypasses UFW iptables INPUT chain! Surfaces loud warnings when containers publish host ports.
   */
  public static async inspectDockerPublishedPorts(
    activeContainerPortMappings: Array<{ containerName: string; hostPort: number; containerPort: number; bindIp?: string }> = []
  ): Promise<DockerPortWarning[]> {
    const warnings: DockerPortWarning[] = [];

    for (const mapping of activeContainerPortMappings) {
      const bindIp = mapping.bindIp || '0.0.0.0';
      const isPublicBind = bindIp === '0.0.0.0' || bindIp === '::' || bindIp === '';

      // Safe ports that are intended to be exposed via NPM
      if (isPublicBind && ![80, 443].includes(mapping.hostPort)) {
        warnings.push({
          containerName: mapping.containerName,
          hostPort: mapping.hostPort,
          containerPort: mapping.containerPort,
          bindIp,
          warning:
            `Security Warning: Container '${mapping.containerName}' publishes host port ${mapping.hostPort} on ${bindIp}. ` +
            `Docker automatically modifies iptables to forward traffic directly to containers, bypassing UFW firewall rules! ` +
            `This service is directly reachable from the internet. Remove the published host port and route via NPM or bind to 127.0.0.1 instead.`
        });
      }
    }

    return warnings;
  }

  /**
   * Formats rule into standard UFW shell command.
   */
  public static generateUfwCommand(rule: FirewallRule): string {
    const proto = rule.protocol !== 'any' ? `proto ${rule.protocol} ` : '';
    const from = rule.source_ip !== 'any' ? `from ${rule.source_ip} ` : '';
    const comment = rule.description ? ` comment '${rule.description.replace(/'/g, '')}'` : '';
    return `ufw ${rule.action} ${proto}${from}to any port ${rule.port}${comment}`.replace(/\s+/g, ' ').trim();
  }
}
