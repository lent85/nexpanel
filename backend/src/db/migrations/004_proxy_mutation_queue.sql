-- Migration 004: Persistent Proxy Mutation Queue (FR-PROXY-07)
CREATE TABLE IF NOT EXISTS proxy_mutation_queue (
  id VARCHAR(64) PRIMARY KEY,
  action VARCHAR(32) NOT NULL,
  edge_host_id INTEGER,
  payload JSONB,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proxy_queue_created ON proxy_mutation_queue(created_at);
