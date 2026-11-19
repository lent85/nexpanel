export type CloudPanelSourceType = 'backup_tar' | 'local_tar_gz' | 'live_ssh';

export type ImportJobStatus =
  | 'uploaded'
  | 'detected'
  | 'mapped'
  | 'dry_run'
  | 'importing'
  | 'verifying'
  | 'done'
  | 'failed'
  | 'rolled_back';

export interface CloudPanelSource {
  type: CloudPanelSourceType;
  fileName: string;
  sha256: string;
  sizeBytes: number;
  detectedAt: string;
  cloudPanelVersion?: string;
  host?: string;
}

export interface CloudPanelVhostLocation {
  path: string;
  note: string;
}

export interface CloudPanelVhostManifest {
  root?: string;
  index?: string;
  clientMaxBodySize?: string;
  customLocations?: CloudPanelVhostLocation[];
}

export interface CloudPanelSiteManifest {
  domain: string;
  aliases: string[];
  type: 'wordpress' | 'php' | 'nodejs' | 'python' | 'static' | 'reverse_proxy';
  typeConfidence: 'high' | 'medium' | 'low';
  typeEvidence: string[];
  phpVersionDetected?: string;
  phpVersionSource?: string;
  documentRoot: string;
  vhostFile?: string;
  vhost: CloudPanelVhostManifest;
  fileCount: number;
  filesSizeBytes: number;
}

export interface CloudPanelDbManifest {
  name: string;
  dumpFile: string;
  dumpSizeBytes: number;
  dumpDate: string;
  engineDetected: string;
  engineVersionDetected: string;
  userDetected: string;
  userSource: string;
  warning?: string;
}

export interface CloudPanelCronJob {
  schedule: string;
  command: string;
  user?: string;
}

export interface CloudPanelCronManifest {
  found: boolean;
  jobs?: CloudPanelCronJob[];
  warning?: string;
}

export interface CloudPanelSshFtpUsersManifest {
  found: boolean;
  users?: string[];
  note?: string;
}

export interface CloudPanelSslManifest {
  found: boolean;
  customCertFound?: boolean;
  note?: string;
}

export interface CloudPanelMappingDefaults {
  domain: string;
  phpVersion: string;
  dbEngine: string;
  sslMode: string;
  searchReplace?: { from: string; to: string } | null;
}

export interface CloudPanelManifest {
  manifestVersion: string;
  source: CloudPanelSource;
  site: CloudPanelSiteManifest;
  databases: CloudPanelDbManifest[];
  cron: CloudPanelCronManifest;
  sshFtpUsers: CloudPanelSshFtpUsersManifest;
  ssl: CloudPanelSslManifest;
  excludesInBackup: string[];
  warnings: string[];
  mappingDefaults: CloudPanelMappingDefaults;
}

export interface CloudPanelMapping {
  domain: string;
  changeDomainTo?: string;
  searchReplaceDomain?: boolean;
  phpVersion: string;
  dbEngineId: string;
  dbName: string;
  dbUser: string;
  dbPassword?: string;
  sslMode: 'letsencrypt-http01-after-dns-cutover' | 'letsencrypt-dns01' | 'custom' | 'none';
  vhostTemplate?: string;
  cronAction?: 'keep' | 'edit' | 'skip';
  cronJobs?: Array<{ schedule: string; command: string }>;
  ownerUserId?: string;
  allowPostgresWordPress?: boolean;
}

export interface CloudPanelDryRunAction {
  step: string;
  description: string;
  details?: Record<string, any>;
}

export interface CloudPanelDryRunCheck {
  name: string;
  status: 'ok' | 'warning' | 'error';
  message: string;
}

export interface CloudPanelDryRunResult {
  valid: boolean;
  actions: CloudPanelDryRunAction[];
  checks: CloudPanelDryRunCheck[];
  warnings: string[];
  errors: string[];
  estimatedDiskRequiredBytes: number;
}

export interface CloudPanelImportReport {
  jobId: string;
  domain: string;
  siteId: string;
  status: 'done' | 'failed' | 'rolled_back';
  durationMs: number;
  importedAt: string;
  site: {
    domain: string;
    type: string;
    phpVersion?: string;
    volumePath: string;
  };
  database?: {
    name: string;
    engine: string;
    user: string;
    importedRows?: number;
  };
  proxyHost?: {
    id: number;
    forwardHost: string;
    forwardPort: number;
  };
  cronJobsCount: number;
  warnings: string[];
  errors?: string[];
  verification: {
    siteDirectoryExists: boolean;
    databaseReachable: boolean;
    configRewritten: boolean;
    httpCheckOk: boolean;
    wpLoginFound?: boolean;
  };
}

export interface CloudPanelImportJobRecord {
  id: string;
  sourceType: CloudPanelSourceType;
  sourceRef: string;
  manifestJson: CloudPanelManifest | null;
  mappingJson: CloudPanelMapping | null;
  dryRunResultJson: CloudPanelDryRunResult | null;
  status: ImportJobStatus;
  targetSiteId: string | null;
  preImportSnapshotId?: string | null;
  reportJson?: CloudPanelImportReport | null;
  logPath: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}
