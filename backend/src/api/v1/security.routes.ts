import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../plugins/auth-guard.js';
import { FirewallManager } from '../../security/firewall-manager.js';
import { SiteSecurityManager } from '../../security/site-security-manager.js';

const createFirewallRuleSchema = z.object({
  direction: z.enum(['inbound', 'outbound']).default('inbound'),
  action: z.enum(['allow', 'deny']),
  port: z.string().min(1).max(32),
  protocol: z.enum(['tcp', 'udp', 'any']).default('tcp'),
  sourceIp: z.string().default('any'),
  description: z.string().optional()
});

const createSiteSecurityRuleSchema = z.object({
  ruleType: z.enum(['ip_block', 'bot_block', 'basic_auth', 'cloudflare_only', 'security_headers']),
  target: z.string().min(1),
  valueJson: z.record(z.any()).optional()
});

export async function securityRoutes(fastify: FastifyInstance): Promise<void> {
  // 1. List Firewall rules
  fastify.get('/api/v1/security/firewall', { preHandler: [requirePermission('settings:manage')] }, async () => {
    const rules = await FirewallManager.listRules();
    return { data: rules, total: rules.length };
  });

  // 2. Add Firewall rule
  fastify.post('/api/v1/security/firewall', { preHandler: [requirePermission('settings:manage')] }, async (request, reply) => {
    const body = createFirewallRuleSchema.parse(request.body);
    const rule = await FirewallManager.addRule(body, request.user!.sub, request.ip);
    reply.status(201).send({
      rule,
      ufwCommand: FirewallManager.generateUfwCommand(rule),
      message: 'Firewall rule created and applied successfully'
    });
  });

  // 3. Delete Firewall rule
  fastify.delete('/api/v1/security/firewall/:id', { preHandler: [requirePermission('settings:manage')] }, async (request) => {
    const { id } = request.params as { id: string };
    await FirewallManager.deleteRule(id, request.user!.sub, request.ip);
    return { message: 'Firewall rule deleted successfully' };
  });

  // 4. Docker port warnings check (FR-SEC-03, NFR-SEC-08)
  fastify.get('/api/v1/security/firewall/warnings', { preHandler: [requirePermission('settings:manage')] }, async () => {
    // Check common container port mappings
    const warnings = await FirewallManager.inspectDockerPublishedPorts();
    return { warnings };
  });

  // 5. List per-site security rules (FR-SEC-04)
  fastify.get('/api/v1/sites/:siteId/security', { preHandler: [requirePermission('sites:view')] }, async (request) => {
    const { siteId } = request.params as { siteId: string };
    const rules = await SiteSecurityManager.listRules(siteId);
    return { data: rules, total: rules.length };
  });

  // 6. Add per-site security rule (IP block, bot block, cloudflare only, headers)
  fastify.post('/api/v1/sites/:siteId/security', { preHandler: [requirePermission('sites:edit')] }, async (request, reply) => {
    const { siteId } = request.params as { siteId: string };
    const body = createSiteSecurityRuleSchema.parse(request.body);
    const rule = await SiteSecurityManager.addRule(
      siteId,
      body.ruleType,
      body.target,
      body.valueJson,
      request.user!.sub,
      request.ip
    );
    reply.status(201).send({ rule, message: 'Site security rule applied successfully' });
  });

  // 7. Delete per-site security rule
  fastify.delete('/api/v1/sites/:siteId/security/:ruleId', { preHandler: [requirePermission('sites:edit')] }, async (request) => {
    const { siteId, ruleId } = request.params as { siteId: string; ruleId: string };
    await SiteSecurityManager.deleteRule(siteId, ruleId, request.user!.sub, request.ip);
    return { message: 'Site security rule removed successfully' };
  });

  // 8. Get generated Nginx security snippet for site
  fastify.get('/api/v1/sites/:siteId/security/nginx-snippet', { preHandler: [requirePermission('sites:view')] }, async (request) => {
    const { siteId } = request.params as { siteId: string };
    const snippet = await SiteSecurityManager.generateNginxSecuritySnippet(siteId);
    return { snippet };
  });
}
