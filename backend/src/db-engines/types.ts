export type DbEngineType = 'mysql' | 'mariadb' | 'postgres';
export type DbEngineMode = 'internal-docker' | 'external-docker' | 'external-remote';
export type DbPrivileges = 'read_write' | 'read_only' | 'custom';

export interface DbEngine {
  id: string;
  name: string;
  type: DbEngineType;
  version: string;
  mode: DbEngineMode;
  container_name?: string;
  image?: string;
  volume?: string;
  internal_port?: number;
  external_container_name?: string;
  network?: string;
  host?: string;
  port?: number;
  tls: boolean;
  tls_ca?: string;
  root_username: string;
  root_password_secret_ref: string;
  is_default: boolean;
  status: 'active' | 'disabled' | 'error' | 'unknown';
  last_checked_at?: string;
  created_at: string;
  updated_at: string;
}

export interface DatabaseRecord {
  id: string;
  site_id?: string;
  engine_id: string;
  name: string;
  charset: string;
  collation: string;
  status: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
}

export interface DbUserRecord {
  id: string;
  database_id: string;
  username: string;
  host: string;
  privileges: DbPrivileges;
  privileges_json?: string;
  password_secret_ref: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
}

export interface CreateEngineInput {
  name: string;
  type: DbEngineType;
  version: string;
  mode: DbEngineMode;
  containerName?: string;
  image?: string;
  volume?: string;
  internalPort?: number;
  externalContainerName?: string;
  network?: string;
  host?: string;
  port?: number;
  tls?: boolean;
  tlsCa?: string;
  rootUsername: string;
  rootPassword: string;
  isDefault?: boolean;
}

export interface CreateDatabaseInput {
  siteId?: string;
  engineId?: string; // If omitted, uses default engine
  name: string;
  charset?: string;
  collation?: string;
  user: {
    username: string;
    password?: string; // If omitted, auto-generate strong password
    host?: string; // Default '%'
    privileges?: DbPrivileges; // Default 'read_write'
    privilegesList?: string[];
  };
  allowPostgresWordPress?: boolean;
}

export interface DumpOptions {
  includeStructure?: boolean;
  includeData?: boolean;
  gzip?: boolean;
}
