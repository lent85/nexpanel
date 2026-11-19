# Runbook: Backup & One-Click Restore

This runbook covers on-demand site backups, scheduled nightly backups, panel self-backups, and 1-click restore operations in NexPanel.

## 1. Site Backup Architectures

Every site backup consists of:
1. `files.tar.gz`: The entire document root (`htdocs/`). Excludes `logs/` and `cache/`.
2. `database.sql.gz`: Consistent database dump from the site's mapped database engine.
3. `manifest.json`: Metadata including domain, PHP version, database engine, cron jobs, and timestamp.

## 2. On-Demand Site Backup

### Via Web UI
1. Navigate to **Sites -> [Your Domain] -> Backups**.
2. Click **Create Backup**.
3. Select destination (Local storage or configured remote: S3, Wasabi, DO Spaces, Dropbox, Google Drive, Hetzner, SFTP).
4. Monitor live progress and download the snapshot archive.

### Via CLI
```bash
nxctl backup:run --site example.com
```

## 3. 1-Click Restore (Better than CloudPanel)

Unlike CloudPanel (which requires manual SSH extraction, rsync, and database import), NexPanel provides automated **1-Click Restore** directly in the UI.

### Automated Safety Pre-Restore Snapshot
Whenever a restore is triggered, NexPanel automatically captures a pre-restore safety snapshot of the existing site state first. If the restored backup contains unexpected errors, you can immediately revert back.

### Triggering a Restore via UI
1. Navigate to **Sites -> [Your Domain] -> Backups**.
2. Locate the desired snapshot and click **Restore**.
3. Choose whether to restore files, database, or both.
4. Confirm by clicking **Proceed with Restore**.

### Triggering a Restore via CLI
```bash
nxctl backup:restore --site example.com --snapshot <snapshotId>
```

## 4. Panel Self-Backup (FR-BKP-05)

The panel metadata database (PostgreSQL 16), configuration files, and edge proxy host mappings are backed up nightly at 02:00.

### Running a Self-Backup
```bash
nxctl backup:self --json
```

### Self-Backup Drills (Quarterly)
1. Restore panel configuration and database dump on a fresh host.
2. Provide the passphrase for `/data/panel/vault.key`.
3. Start the containers and execute `nxctl proxy:sync --reconcile`.
4. Verify that existing sites recover in under 30 minutes.
