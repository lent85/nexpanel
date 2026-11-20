export type UserRole = 'admin' | 'site_manager' | 'user' | 'client';
export type UserStatus = 'active' | 'disabled';

export interface User {
  id: string; // UUID v7
  email: string;
  username: string;
  firstName?: string;
  lastName?: string;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  timezone: string;
  language: string;
  totpEnabled: boolean;
  totpSecretRef?: string;
  recoveryCodesHash?: string[];
  lastLoginAt?: string;
  lastLoginIp?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export type SiteType = 'wordpress' | 'php' | 'nodejs' | 'python' | 'static' | 'reverse_proxy' | 'docker_app' | 'git';
export type SiteStatus = 'provisioning' | 'live' | 'disabled' | 'error' | 'deleting' | 'trashed';

export interface Site {
  id: string; // UUID v7
  domain: string;
  aliases: string[];
  type: SiteType;
  status: SiteStatus;
  phpVersion?: string;
  nodeVersion?: string;
  pythonVersion?: string;
  documentRoot: string;
  siteUserUid: number;
  volumePath: string;
  originContainerName: string;
  originPort: number;
  edgeProviderId?: string;
  edgeHostId?: number;
  edgeCertId?: number;
  dbEngineId?: string;
  varnishEnabled: boolean;
  redisEnabled: boolean;
  maintenanceMode: boolean;
  tags: string[];
  notes?: string;
  ownerUserId?: string;
  hostId: string; // default 'host-1' for v2 multi-host readiness
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export type DbEngineMode = 'internal-docker' | 'external-docker' | 'external-remote';
export type DbEngineType = 'mysql' | 'mariadb' | 'postgresql';
export type DbEngineStatus = 'unknown' | 'reachable' | 'unreachable';

export interface DbEngine {
  id: string;
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
  rootPasswordSecretRef: string;
  isDefault: boolean;
  status: DbEngineStatus;
  lastCheckedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Database {
  id: string;
  siteId?: string;
  engineId: string;
  name: string;
  charset: string;
  collation: string;
  status: 'active' | 'error' | 'trashed';
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export type DbPrivilegeType = 'read_write' | 'read_only' | 'custom';

export interface DbUser {
  id: string;
  databaseId: string;
  username: string;
  host: string;
  privileges: DbPrivilegeType;
  privilegesJson?: Record<string, boolean>;
  passwordSecretRef: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface EdgeProvider {
  id: string;
  kind: 'npm';
  name: string;
  baseUrl: string;
  adminEmail: string;
  credentialsSecretRef: string;
  networkName: string;
  status: 'reachable' | 'unreachable' | 'unknown';
  version?: string;
  lastCheckedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type DriftStatus = 'in_sync' | 'drifted' | 'missing_on_edge' | 'orphan_on_edge';

export interface ProxyHost {
  id: string;
  siteId?: string;
  edgeProviderId: string;
  edgeHostId: number;
  domainNames: string[];
  forwardScheme: 'http' | 'https';
  forwardHost: string;
  forwardPort: number;
  certificateId?: number;
  sslForced: boolean;
  hsts: boolean;
  http2: boolean;
  websocket: boolean;
  accessListId?: number;
  enabled: boolean;
  driftStatus: DriftStatus;
  lastSyncedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Certificate {
  id: string;
  siteId?: string;
  edgeProviderId: string;
  edgeCertId: number;
  domainNames: string[];
  provider: 'letsencrypt' | 'custom';
  dnsChallenge: boolean;
  dnsProvider?: string;
  expiresAt?: string;
  autoRenew: boolean;
  status: 'valid' | 'expiring' | 'expired' | 'failed';
  createdAt: string;
  updatedAt: string;
}

export interface CronJob {
  id: string;
  siteId: string;
  name: string;
  schedule: string;
  command: string;
  enabled: boolean;
  timeoutSec: number;
  notifyOnFailure: boolean;
  lastRunAt?: string;
  lastExitCode?: number;
  nextRunAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CronRun {
  id: string;
  cronJobId: string;
  startedAt: string;
  finishedAt?: string;
  exitCode?: number;
  stdoutTail?: string;
  stderrTail?: string;
  durationMs?: number;
}

export interface AuditLog {
  id: string;
  actorUserId?: string;
  actorIp?: string;
  action: string;
  entityType: string;
  entityId?: string;
  beforeJson?: Record<string, unknown>;
  afterJson?: Record<string, unknown>;
  createdAt: string;
}

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface Job {
  id: string;
  type: string;
  payloadJson: Record<string, unknown>;
  idempotencyKey?: string;
  status: JobStatus;
  progressPct: number;
  logPath?: string;
  attempts: number;
  maxAttempts: number;
  createdByUserId?: string;
  siteId?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface VhostTemplate {
  id: string;
  name: string;
  siteType: SiteType;
  body: string;
  isBuiltIn: boolean;
  version: number;
  createdByUserId?: string;
  createdAt: string;
  updatedAt: string;
}
