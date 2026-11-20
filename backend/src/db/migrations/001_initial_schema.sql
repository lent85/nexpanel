-- NexPanel Schema Migration 001: Initial Entities
-- Engine: PostgreSQL 16 (Panel Metadata DB)

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  username VARCHAR(64) NOT NULL UNIQUE,
  first_name VARCHAR(128),
  last_name VARCHAR(128),
  password_hash TEXT NOT NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'user',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Bangkok',
  language VARCHAR(16) NOT NULL DEFAULT 'en',
  totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  totp_secret_ref TEXT,
  recovery_codes_hash TEXT,
  last_login_at TIMESTAMPTZ,
  last_login_ip VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS db_engines (
  id UUID PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  type VARCHAR(32) NOT NULL,
  version VARCHAR(32) NOT NULL,
  mode VARCHAR(32) NOT NULL,
  container_name VARCHAR(128),
  image VARCHAR(255),
  volume VARCHAR(255),
  internal_port INTEGER,
  external_container_name VARCHAR(128),
  network VARCHAR(128),
  host VARCHAR(255),
  port INTEGER,
  tls BOOLEAN NOT NULL DEFAULT FALSE,
  tls_ca TEXT,
  root_username VARCHAR(128) NOT NULL,
  root_password_secret_ref TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(32) NOT NULL DEFAULT 'unknown',
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS edge_providers (
  id UUID PRIMARY KEY,
  kind VARCHAR(32) NOT NULL DEFAULT 'npm',
  name VARCHAR(128) NOT NULL,
  base_url VARCHAR(255) NOT NULL,
  admin_email VARCHAR(255) NOT NULL,
  credentials_secret_ref TEXT NOT NULL,
  network_name VARCHAR(64) NOT NULL DEFAULT 'proxy',
  status VARCHAR(32) NOT NULL DEFAULT 'unknown',
  version VARCHAR(32),
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sites (
  id UUID PRIMARY KEY,
  domain VARCHAR(255) NOT NULL UNIQUE,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  type VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'provisioning',
  php_version VARCHAR(16),
  node_version VARCHAR(16),
  python_version VARCHAR(16),
  document_root VARCHAR(255) NOT NULL,
  site_user_uid INTEGER NOT NULL DEFAULT 1001,
  volume_path VARCHAR(255) NOT NULL,
  origin_container_name VARCHAR(128) NOT NULL,
  origin_port INTEGER NOT NULL DEFAULT 8080,
  edge_provider_id UUID REFERENCES edge_providers(id) ON DELETE SET NULL,
  edge_host_id INTEGER,
  edge_cert_id INTEGER,
  db_engine_id UUID REFERENCES db_engines(id) ON DELETE SET NULL,
  varnish_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  redis_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  maintenance_mode BOOLEAN NOT NULL DEFAULT FALSE,
  tags TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT,
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  host_id VARCHAR(64) NOT NULL DEFAULT 'host-1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS databases (
  id UUID PRIMARY KEY,
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  engine_id UUID NOT NULL REFERENCES db_engines(id) ON DELETE CASCADE,
  name VARCHAR(64) NOT NULL,
  charset VARCHAR(32) NOT NULL DEFAULT 'utf8mb4',
  "collation" VARCHAR(64) NOT NULL DEFAULT 'utf8mb4_unicode_ci',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT uq_engine_dbname UNIQUE (engine_id, name)
);

CREATE TABLE IF NOT EXISTS db_users (
  id UUID PRIMARY KEY,
  database_id UUID NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
  username VARCHAR(64) NOT NULL,
  host VARCHAR(64) NOT NULL DEFAULT '%',
  privileges VARCHAR(32) NOT NULL DEFAULT 'read_write',
  privileges_json JSONB,
  password_secret_ref TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT uq_database_username UNIQUE (database_id, username)
);

CREATE TABLE IF NOT EXISTS proxy_hosts (
  id UUID PRIMARY KEY,
  site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
  edge_provider_id UUID NOT NULL REFERENCES edge_providers(id) ON DELETE CASCADE,
  edge_host_id INTEGER NOT NULL,
  domain_names TEXT[] NOT NULL,
  forward_scheme VARCHAR(16) NOT NULL DEFAULT 'http',
  forward_host VARCHAR(255) NOT NULL,
  forward_port INTEGER NOT NULL DEFAULT 8080,
  certificate_id INTEGER,
  ssl_forced BOOLEAN NOT NULL DEFAULT FALSE,
  hsts BOOLEAN NOT NULL DEFAULT FALSE,
  http2 BOOLEAN NOT NULL DEFAULT TRUE,
  websocket BOOLEAN NOT NULL DEFAULT FALSE,
  access_list_id INTEGER,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  drift_status VARCHAR(32) NOT NULL DEFAULT 'in_sync',
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS certificates (
  id UUID PRIMARY KEY,
  site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
  edge_provider_id UUID NOT NULL REFERENCES edge_providers(id) ON DELETE CASCADE,
  edge_cert_id INTEGER NOT NULL,
  domain_names TEXT[] NOT NULL,
  provider VARCHAR(32) NOT NULL DEFAULT 'letsencrypt',
  dns_challenge BOOLEAN NOT NULL DEFAULT FALSE,
  dns_provider VARCHAR(64),
  expires_at TIMESTAMPTZ,
  auto_renew BOOLEAN NOT NULL DEFAULT TRUE,
  status VARCHAR(32) NOT NULL DEFAULT 'valid',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cron_jobs (
  id UUID PRIMARY KEY,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name VARCHAR(128) NOT NULL,
  schedule VARCHAR(64) NOT NULL,
  command TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  timeout_sec INTEGER NOT NULL DEFAULT 3600,
  notify_on_failure BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at TIMESTAMPTZ,
  last_exit_code INTEGER,
  next_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cron_runs (
  id UUID PRIMARY KEY,
  cron_job_id UUID NOT NULL REFERENCES cron_jobs(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  exit_code INTEGER,
  stdout_tail TEXT,
  stderr_tail TEXT,
  duration_ms INTEGER
);

CREATE TABLE IF NOT EXISTS backup_destinations (
  id UUID PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  provider VARCHAR(32) NOT NULL,
  config_secret_ref TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS backups (
  id UUID PRIMARY KEY,
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  destination_id UUID REFERENCES backup_destinations(id) ON DELETE SET NULL,
  schedule VARCHAR(64),
  retention_days INTEGER NOT NULL DEFAULT 7,
  include_files BOOLEAN NOT NULL DEFAULT TRUE,
  include_db BOOLEAN NOT NULL DEFAULT TRUE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at TIMESTAMPTZ,
  last_status VARCHAR(32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS backup_runs (
  id UUID PRIMARY KEY,
  backup_id UUID NOT NULL REFERENCES backups(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status VARCHAR(32) NOT NULL DEFAULT 'running',
  size_bytes BIGINT,
  snapshot_id VARCHAR(128),
  error TEXT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS import_jobs (
  id UUID PRIMARY KEY,
  source_type VARCHAR(32) NOT NULL,
  source_ref TEXT NOT NULL,
  manifest_json JSONB,
  mapping_json JSONB,
  dry_run_result_json JSONB,
  status VARCHAR(32) NOT NULL DEFAULT 'uploaded',
  target_site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
  log_path TEXT,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY,
  type VARCHAR(64) NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}',
  idempotency_key VARCHAR(255) UNIQUE,
  status VARCHAR(32) NOT NULL DEFAULT 'queued',
  progress_pct INTEGER NOT NULL DEFAULT 0,
  log_path TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_ip VARCHAR(64),
  action VARCHAR(128) NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  entity_id VARCHAR(128),
  before_json JSONB,
  after_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vhost_templates (
  id UUID PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  site_type VARCHAR(32) NOT NULL,
  body TEXT NOT NULL,
  is_built_in BOOLEAN NOT NULL DEFAULT FALSE,
  version INTEGER NOT NULL DEFAULT 1,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  ip_address VARCHAR(64),
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id UUID PRIMARY KEY,
  identifier VARCHAR(255) NOT NULL,
  ip_address VARCHAR(64) NOT NULL,
  success BOOLEAN NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_sites_domain ON sites(domain);
CREATE INDEX IF NOT EXISTS idx_sites_status ON sites(status);
CREATE INDEX IF NOT EXISTS idx_databases_site_id ON databases(site_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_idempotency_key ON jobs(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_time ON login_attempts(ip_address, attempted_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_id_time ON login_attempts(identifier, attempted_at);
