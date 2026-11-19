# Runbook: Complete Disaster Recovery

This runbook guides administrators through restoring NexPanel and all hosted websites from backups on a brand new server following a catastrophic host failure.

## 1. Prerequisites for Recovery Host

- Fresh server running Ubuntu 22.04 / 24.04 or Debian 12 / 13.
- Ports 80, 443, 22 open.
- Access to remote backup storage (S3 / Wasabi / DO Spaces / SFTP) containing:
  1. The latest panel self-backup archive (`nexpanel-self-backup-<date>.tar.gz`).
  2. The secrets vault key (`vault.key`) or your vault passphrase.
  3. Site backup snapshots (`<slug>-<date>.tar.gz`).

## 2. Step 1: Install NexPanel on New Host

Run the single-command installer to prepare Docker and network interfaces:
```bash
curl -fsSL https://get.nexpanel.example/install.sh | sudo bash
```

## 3. Step 2: Restore Secrets Vault Key

Copy your backed up `vault.key` into `/data/panel/vault.key`:
```bash
sudo cp /path/to/vault.key /data/panel/vault.key
sudo chmod 600 /data/panel/vault.key
```

> **Warning:** Without `vault.key`, encrypted database passwords and remote backup destination secrets cannot be decrypted.

## 4. Step 3: Restore Panel Metadata Database

Extract the self-backup archive and restore the PostgreSQL metadata tables:
```bash
tar -xzf nexpanel-self-backup-<date>.tar.gz -C /tmp/self-restore
docker exec -i nexpanel-db psql -U nexpanel nexpanel < /tmp/self-restore/metadata.sql
```

Restart panel services:
```bash
cd /opt/nexpanel && docker compose restart nexpanel-web nexpanel-worker
```

## 5. Step 4: Reconcile Edge Proxy Hosts

Run `proxy:sync --reconcile` to instruct NPM to re-create all edge routing rules:
```bash
nxctl proxy:sync --reconcile
```

## 6. Step 5: Restore Sites and Databases

For each hosted site, run 1-click restore:
```bash
nxctl backup:restore --site <domain> --snapshot /path/to/<site-snapshot>.tar.gz
```

## 7. Recovery Target Time

- Panel metadata and configuration recovery: **< 15 minutes**
- Complete server restoration drill: **< 30 minutes (FR-BKP-05, NFR-REL-05)**
