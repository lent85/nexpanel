-- Migration 003: Site Assignments for Multi-User RBAC
CREATE TABLE IF NOT EXISTS site_assignments (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, site_id)
);

CREATE INDEX IF NOT EXISTS idx_site_assignments_user ON site_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_site_assignments_site ON site_assignments(site_id);
