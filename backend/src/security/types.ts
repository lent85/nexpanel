export type FirewallDirection = 'inbound' | 'outbound';
export type FirewallAction = 'allow' | 'deny';
export type FirewallProtocol = 'tcp' | 'udp' | 'any';

export interface FirewallRule {
  id: string;
  direction: FirewallDirection;
  action: FirewallAction;
  port: string;
  protocol: FirewallProtocol;
  source_ip: string;
  description?: string;
  is_system: boolean;
  status: 'applied' | 'pending' | 'disabled';
  created_at: string;
  updated_at: string;
}

export interface CreateFirewallRuleInput {
  direction?: FirewallDirection;
  action: FirewallAction;
  port: string;
  protocol?: FirewallProtocol;
  sourceIp?: string;
  description?: string;
}

export type SiteSecurityRuleType =
  | 'ip_block'
  | 'bot_block'
  | 'basic_auth'
  | 'cloudflare_only'
  | 'security_headers';

export interface SiteSecurityRule {
  id: string;
  site_id: string;
  rule_type: SiteSecurityRuleType;
  target: string;
  value_json?: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface DockerPortWarning {
  containerName: string;
  hostPort: number;
  containerPort: number;
  bindIp: string;
  warning: string;
}
