export type BackupProviderType =
  | 's3'
  | 'wasabi'
  | 'do_spaces'
  | 'dropbox'
  | 'gdrive'
  | 'sftp'
  | 'local';

export interface BackupDestination {
  id: string;
  name: string;
  provider: BackupProviderType;
  config_secret_ref: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateDestinationInput {
  name: string;
  provider: BackupProviderType;
  config: {
    bucket?: string;
    region?: string;
    endpoint?: string;
    accessKey?: string;
    secretKey?: string;
    path?: string;
    encrypted?: boolean;
    encryptionPassphrase?: string;
    sftpHost?: string;
    sftpPort?: number;
    sftpUser?: string;
    sftpKey?: string;
    sftpPassword?: string;
    [key: string]: unknown;
  };
}

export interface BackupSchedule {
  id: string;
  site_id?: string;
  destination_id?: string;
  schedule: string;
  retention_days: number;
  include_files: boolean;
  include_db: boolean;
  enabled: boolean;
  last_run_at?: string;
  last_status?: string;
  created_at: string;
  updated_at: string;
}

export interface BackupRun {
  id: string;
  backup_id: string;
  started_at: string;
  finished_at?: string;
  status: 'running' | 'success' | 'failed';
  size_bytes?: number;
  snapshot_id: string;
  error?: string;
  verified_at?: string;
  created_at: string;
}

export interface RestoreOptions {
  siteId: string;
  snapshotPathOrId: string;
  restoreFiles?: boolean;
  restoreDb?: boolean;
  preRestoreBackup?: boolean;
}

export interface RestoreResult {
  success: boolean;
  siteDomain: string;
  filesRestored: boolean;
  dbRestored: boolean;
  preRestoreSnapshotId?: string;
  message: string;
}
