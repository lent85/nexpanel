# 04 — Data Model & API

## 4.1 Entities (panel metadata DB — PostgreSQL)

> `id` is UUID v7 everywhere. `createdAt` / `updatedAt` on every row. Soft-delete (`deletedAt`) for Site, Database, DbUser, User — hard-delete only after trash expiry. Secrets are **never** in these tables as plaintext — they live in the vault and are referenced by `secretRef`.

### User
| Field | Type | Notes |
|---|---|---|
| id, email (unique), username (unique), firstName, lastName, passwordHash (Argon2id), role (`admin` \| `site_manager` \| `user` \| `client`), status (`active` \| `disabled`), timezone, language, totpEnabled, totpSecretRef, lastLoginAt, lastLoginIp | | Role matrix in §4.4 |

### Site
| Field | Type | Notes |
|---|---|---|
| id, domain (unique, lowercase), aliases (text[]), type (`wordpress` \| `php` \| `nodejs` \| `python` \| `static` \| `reverse_proxy` \| `docker_app` \| `git`), status (`provisioning` \| `live` \| `disabled` \| `error` \| `deleting` \| `trashed`), phpVersion (nullable), nodeVersion, pythonVersion, documentRoot, siteUserUid, volumePath, originContainerName, originPort, edgeProviderId, edgeHostId (NPM host id), edgeCertId, dbEngineId (default for the site), varnishEnabled, redisEnabled, maintenanceMode, tags (text[]), notes, ownerUserId, hostId (default `host-1`, §3.8) | | One row per site; a site's files live at `volumePath` |

### Database (site DB)
| Field | Type | Notes |
|---|---|---|
| id, siteId (FK), engineId (FK → DbEngine), name (unique per engine), charset, collation, status | | Name uniqueness is per-engine, not global — two engines can both have `wp_abc` |

### DbUser
| Field | Type | Notes |
|---|---|---|
| id, databaseId (FK), username (unique per engine), host (`%` \| `localhost` \| CIDR), privileges (`read_write` \| `read_only` \| `custom`), privilegesJson, passwordSecretRef | | Password never returned by the API except at creation (once) |

### DbEngine
See §03.4.1 for the full shape. Stored as a table with `mode`, `type`, `version`, `host`, `port`, `tls`, `containerName`, `image`, `volume`, `isDefault`, `status`, `lastCheckedAt`, `rootUsername`, `rootPasswordSecretRef`.

### EdgeProvider (NPM instance)
| Field | Type | Notes |
|---|---|---|
| id, kind (`npm`), name, baseUrl, adminEmail, credentialsSecretRef (password/token), networkName (default `proxy`), status, lastCheckedAt, version | | v1 has one NPM; the table allows many for v2 multi-host |

### ProxyHost (panel's view of an NPM host)
| Field | Type | Notes |
|---|---|---|
| id, siteId (nullable — redirection/standalone hosts have no site), edgeProviderId, edgeHostId, domainNames (text[]), forwardScheme, forwardHost, forwardPort, certificateId, sslForced, hsts, http2, websocket, accessListId, enabled, lastSyncedAt, driftStatus (`in_sync` \| `drifted` \| `missing_on_edge` \| `orphan_on_edge`) | | Reconciler updates `driftStatus` |

### Certificate
| Field | Type | Notes |
|---|---|---|
| id, siteId, edgeProviderId, edgeCertId, domainNames, provider (`letsencrypt` \| `custom`), dnsChallenge (bool), dnsProvider, expiresAt, autoRenew (bool), status | | Expiry job reads this table daily |

### CronJob
| Field | Type | Notes |
|---|---|---|
| id, siteId, name, schedule (cron expr), command, enabled, timeoutSec, notifyOnFailure, lastRunAt, lastExitCode, nextRunAt | | Runs are in `CronRun` (see below) |

### CronRun
| Field | Type | Notes |
|---|---|---|
| id, cronJobId, startedAt, finishedAt, exitCode, stdoutTail, stderrTail, durationMs | | Retention 90 days, then pruned |

### Backup / BackupDestination / BackupRun
- `BackupDestination`: id, name, provider (`s3` \| `wasabi` \| `do_spaces` \| `dropbox` \| `gdrive` \| `hetzner` \| `sftp` \| `rclone_custom`), configSecretRef (rclone config encrypted), enabled.
- `Backup`: id, siteId (nullable = panel self-backup), destinationId, schedule, retentionDays, includeFiles, includeDb, enabled, lastRunAt, lastStatus.
- `BackupRun`: id, backupId, startedAt, finishedAt, status, sizeBytes, snapshotId (rclone/restic id), error, verifiedAt (test-restore).

### ImportJob (CloudPanel import)
| Field | Type | Notes |
|---|---|---|
| id, sourceType (`backup_tar` \| `local_tar_gz` \| `live_ssh`), sourceRef (file path / host), manifestJson, mappingJson, dryRunResultJson, status (`uploaded` \| `detected` \| `mapped` \| `dry_run` \| `importing` \| `verifying` \| `done` \| `failed` \| `rolled_back`), targetSiteId, logPath, createdByUserId | | Detail in §05 |

### Job (background jobs)
| Field | Type | Notes |
|---|---|---|
| id, type, payloadJson, idempotencyKey (unique), status (`queued` \| `running` \| `done` \| `failed` \| `cancelled`), progressPct, logPath, attempts, maxAttempts, createdByUserId, siteId (nullable) | | pg-boss backed |

### AuditLog
| Field | Type | Notes |
|---|---|---|
| id, actorUserId (nullable = system), actorIp, action (`site.create`, `db.password.change`, `proxy.host.delete`, …), entityType, entityId, beforeJson, afterJson (no secrets), createdAt | | Append-only; no UPDATE/DELETE via the API |

### VhostTemplate
| Field | Type | Notes |
|---|---|---|
| id, name, siteType, body (Nginx snippet), isBuiltIn, version, createdByUserId | | Versioned; editing creates a new version, old sites keep their version until they opt in |

## 4.2 Relationships (summary)

```
User 1—* Site (owner)          User *—* Site (assigned, via SiteAssignment)
Site 1—* Database 1—* DbUser
Site 1—* CronJob 1—* CronRun
Site 1—1 ProxyHost (or 1—* for aliases on separate hosts — v1: 1 host with many domain_names)
Site 1—* Certificate
DbEngine 1—* Database
EdgeProvider 1—* ProxyHost, 1—* Certificate
BackupDestination 1—* Backup 1—* BackupRun
Site 1—* ImportJob (as target) / ImportJob 1—1 Site (created)
```

## 4.3 REST API — `/api/v1`

- **Auth:** `Authorization: Bearer <JWT>` (web) or `Authorization: Bearer <API token>` (automation). Tokens are scoped (`sites:read`, `sites:write`, `db:write`, `admin:*`) and shown with last-used.
- **Format:** JSON. Errors: `{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [...] } }`. Pagination: `?page=1&per_page=25` → `{ data, meta: { total, page, per_page } }`.
- **Idempotency:** `Idempotency-Key` header on POSTs that create things (site, DB, proxy host). Replaying the same key returns the original result, not a duplicate.
- **Versioning:** `/api/v1` — breaking changes go to `/api/v2`, v1 is supported for at least 12 months after v2 ships.

| Resource | Endpoints (representative — full OpenAPI is a build deliverable) |
|---|---|
| Auth | `POST /auth/login`, `POST /auth/logout`, `POST /auth/totp/setup|verify`, `POST /auth/refresh`, `GET /auth/me` |
| Sites | `GET /sites`, `POST /sites`, `GET /sites/:id`, `PATCH /sites/:id`, `DELETE /sites/:id`, `POST /sites/:id/enable|disable`, `POST /sites/:id/clone` (staging), `POST /sites/:id/push-live` |
| Databases | `GET /sites/:id/databases`, `POST /sites/:id/databases`, `GET /databases/:id`, `DELETE /databases/:id`, `POST /databases/:id/export`, `POST /databases/:id/import`, `GET /databases/:id/users`, `POST /databases/:id/users` |
| Engines | `GET /db-engines`, `POST /db-engines`, `PATCH /db-engines/:id`, `POST /db-engines/:id/test`, `POST /db-engines/:id/enable|disable`, `POST /databases/:id/migrate` |
| Proxy / NPM | `GET /edge-providers`, `POST /edge-providers`, `POST /edge-providers/:id/test`, `GET /edge-providers/:id/hosts`, `POST /edge-providers/:id/sync` (reconcile), `GET /sites/:id/proxy-host` |
| Certificates | `GET /sites/:id/certificates`, `POST /sites/:id/certificates` (LE / DNS-01 / custom), `DELETE /certificates/:id`, `POST /certificates/:id/renew` |
| Files | `GET /sites/:id/files?path=…`, `POST /sites/:id/files/upload` (chunked), `GET /sites/:id/files/download?path=…`, `POST /sites/:id/files/mkdir|rename|delete|chmod`, `GET /sites/:id/files/trash`, `POST /sites/:id/files/restore` |
| SSH/SFTP users | `GET /sites/:id/ssh-users`, `POST /sites/:id/ssh-users`, `DELETE /sites/:id/ssh-users/:userId`, `POST /sites/:id/ssh-users/:userId/keys` |
| Cron | `GET /sites/:id/cron`, `POST /sites/:id/cron`, `PATCH /cron/:id`, `DELETE /cron/:id`, `POST /cron/:id/run-now`, `GET /cron/:id/runs` |
| Logs | `GET /sites/:id/logs?type=nginx-access&tail=200&search=500`, `GET /sites/:id/logs/stream` (SSE) |
| Backups | `GET /backup-destinations`, `POST /backup-destinations`, `GET /sites/:id/backups`, `POST /sites/:id/backups` (on-demand), `POST /backups/:id/restore`, `GET /backups/:id/runs` |
| Import | `POST /imports/cloudpanel` (upload or live-SSH), `GET /imports/:id`, `GET /imports/:id/detect`, `POST /imports/:id/mapping`, `POST /imports/:id/dry-run`, `POST /imports/:id/run`, `POST /imports/:id/rollback` |
| Users / Admin | `GET /users`, `POST /users`, `PATCH /users/:id`, `GET /admin/vhost-templates`, `POST /admin/vhost-templates`, `GET /admin/services`, `POST /admin/services/:id/restart`, `GET /admin/events`, `GET /admin/settings`, `PATCH /admin/settings` |
| Jobs | `GET /jobs/:id` (progress + logs) |
| Health | `GET /health` (no auth — for Docker HEALTHCHECK), `GET /health/ready` |

## 4.4 RBAC matrix (MVP)

| Action | Admin | Site Manager | User (assigned) | Client |
|---|---|---|---|---|
| Admin Area (users, engines, NPM, firewall, settings) | ✅ | ❌ | ❌ | ❌ |
| Create / delete site | ✅ | ✅ | ❌ (only assigned) | ❌ |
| Edit site (PHP, vhost, SSL, cron, files) | ✅ | ✅ | ✅ assigned | 👁 read-only |
| View DB password / reveal secret | ✅ | ✅ | ✅ assigned | ❌ |
| Create / delete DB | ✅ | ✅ | ✅ assigned | ❌ |
| Import CloudPanel | ✅ | ✅ | ❌ | ❌ |
| Restore backup | ✅ | ✅ | ✅ assigned | ❌ |
| Manage panel users | ✅ | ❌ | ❌ | ❌ |
| API tokens (own) | ✅ | ✅ | ✅ | ✅ read-only scope |

Granular toggles (e.g. "can deploy but not delete") are v1.1 — the permission model must be a table, not hard-coded `if role == admin` checks, so v1.1 does not need a rewrite.

## 4.5 CLI — `nxctl`

`nxctl` is a thin client over the same REST API (plus a few host-local commands that need Docker/host access). It must work over SSH on the panel host and remotely with `--api-url + --token`.

```
nxctl site:create --domain example.com --type wordpress --php 8.3 --db-engine internal-mysql
nxctl site:list --json
nxctl site:delete --domain example.com --keep-db
nxctl db:add --domain example.com --database wp_db --user wp_user
nxctl db:export --database wp_db --file /tmp/wp_db.sql.gz
nxctl db:import --database wp_db --file /tmp/wp_db.sql.gz
nxctl db:backup --databases all --retention 7
nxctl user:add --username jane --email jane@x.com --role site_manager
nxctl user:reset:password --username jane
nxctl user:disable:mfa --username jane
nxctl proxy:sync --reconcile
nxctl import:cloudpanel --file backup.tar --dry-run
nxctl import:cloudpanel --host old.cloudpanel.example --user root --key ~/.ssh/id_ed25519
nxctl backup:run --site example.com
nxctl panel:enable:basic-auth --username admin
nxctl health
```

Every command: `--help`, `--json` (machine-readable), non-zero exit on failure, no secrets in stdout.

## 4.6 Events & webhooks

- **Internal events** (for the audit log + dashboard): `site.created`, `site.deleted`, `db.created`, `db.password.changed`, `proxy.host.created`, `cert.expiring`, `backup.failed`, `import.completed`, `user.login`, `user.login_failed`.
- **Webhooks (v1.1, design in v1):** `POST` to a user URL with HMAC signature, retry 3×, payload `{ event, entity, actor, at, data }`. The event table exists in v1; the webhook sender ships in v1.1.
- **Email:** SMTP (external provider) for password reset, SSL expiry, backup/cron failure, new-IP login. No local mail server.
