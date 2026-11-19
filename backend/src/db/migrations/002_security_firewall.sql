CREATE TABLE IF NOT EXISTS firewall_rules (
  id UUID PRIMARY KEY,
  direction VARCHAR(16) NOT NULL DEFAULT 'inbound',
  action VARCHAR(16) NOT NULL DEFAULT 'allow',
  port VARCHAR(32) NOT NULL,
  protocol VARCHAR(16) NOT NULL DEFAULT 'tcp',
  source_ip VARCHAR(64) NOT NULL DEFAULT 'any',
  description VARCHAR(255),
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(32) NOT NULL DEFAULT 'applied',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS site_security_rules (
  id UUID PRIMARY KEY,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  rule_type VARCHAR(32) NOT NULL,
  target VARCHAR(255) NOT NULL,
  value_json JSONB,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_firewall_rules_port ON firewall_rules(port);
CREATE INDEX IF NOT EXISTS idx_site_security_rules_site ON site_security_rules(site_id);
