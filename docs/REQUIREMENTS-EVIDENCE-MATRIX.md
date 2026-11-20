# NexPanel — Requirement-to-Evidence & Parity Matrix

This document provides a comprehensive mapping between every functional requirement, its delivery status (**implemented** / **partial** / **simulated** / **missing**), source implementation files, and verifiable executable acceptance tests.

---

## 1. Scope Statement Clarifications & Architecture Guards

### 1.1 SSL DNS-01 vs Out-of-Scope DNS Server (FR-PROXY-05 vs W2)
* **Scope Distinction**: NexPanel **never** operates an authoritative or recursive DNS name server on the host (satisfying `W2` out-of-scope rule).
* **DNS-01 ACME Challenge Execution**: DNS-01 SSL challenges (`FR-PROXY-05`) for Let's Encrypt certificates are delegated entirely to **Nginx Proxy Manager's (NPM 2.16.0)** upstream certbot DNS provider plugins (Cloudflare, Route53, DigitalOcean, etc.). Credentials (API tokens) are supplied by the administrator and forwarded to NPM via REST API; NexPanel does not manage DNS zone records itself.

### 1.2 Reverse-Proxy Upstream Routing vs Hard Rule R1 (FR-SITE-07 vs R1)
* **Hard Rule R1 Enforcement**:
  - `forward_host` in proxy configurations MUST NEVER be `localhost` or `127.0.0.1` (which resolves inside the NPM container to NPM itself, triggering a fatal 502 loop).
* **Upstream Resolution**:
  - **Internal Container Sites**: Must use the Docker container/service name on the shared `proxy` network (e.g., `site-example-com`).
  - **Reverse Proxy Sites (`FR-SITE-07`)**: When proxying to an external daemon or host upstream (e.g. `http://192.168.1.50:8096` or `https://api.external.service`), the target host must be a non-loopback IP or valid external FQDN. Attempting to forward to `localhost` or `127.0.0.1` is validated and rejected at both UI and API levels with clear remediation guidance.

### 1.3 Pluggable Engine Immutability & Metadata Isolation (FR-DB-02 vs R2)
* NexPanel's metadata database (`nexpanel-db`, PostgreSQL 16) is strictly private and cannot be registered or accessed as a site database engine.
* External database engines (`external-docker` and `external-remote`) are immutable and cannot be stopped, restarted, or deleted by the panel.

### 1.4 CloudPanel Import Guards & Rollback Safety (FR-IMP-02 vs R3)
* Every CloudPanel import requires dry-run diff simulation and idempotency checks before execution.
* WordPress on PostgreSQL is blocked by default during dry run.
* Automatic pre-import backup and 1-click rollback ensure the host is restored to clean state on failure.

---

## 2. Requirement-to-Evidence Parity Matrix

### Status Legend
* **Implemented**: Fully implemented with genuine production logic, validated by automated integration and regression tests.
* **Partial**: Partially implemented or verified in unit/test harness; secondary live host or multi-container verification remaining.
* **Simulated**: In-memory test fixture or mock adapter used solely for rapid unit testing without external hardware dependencies.
* **Missing**: Scheduled for subsequent milestone (v1.1 or v2).

| Requirement ID | Feature Area | MVP / Priority | Status | Source Implementation | Executable Test Suite | Verification Evidence |
|---|---|---|---|---|---|---|
| **FR-SITE-01** | 6 Site Types & Isolation | MVP (M) | **Implemented** | `backend/src/sites/site-service.ts`, `container-runner.ts` | `backend/test/m4-sites.test.ts` | Validates creation of WordPress, PHP, Node, Python, Static, Reverse Proxy with isolated paths and UIDs. |
| **FR-SITE-02** | WordPress 1-Click Install | MVP (M) | **Implemented** | `backend/src/sites/wordpress-scaffolder.ts`, `site-service.ts` | `backend/test/wordpress-workflow.test.ts` | Real WordPress core files, genuine database schema initialization, and administrator seeding. |
| **FR-SITE-03** | PHP 7.1–8.5 Per-Site Switch | MVP (M) | **Implemented** | `backend/src/sites/vhost-generator.ts`, `site-service.ts` | `backend/test/m4-sites.test.ts` | Switches PHP version 8.2 -> 8.3 and regenerates origin vhost. |
| **FR-SITE-04** | Node.js Multi-Version Sites | MVP (M) | **Implemented** | `backend/src/sites/container-runner.ts` | `backend/test/m3-multi-runtime-proxy.test.ts` | Multi-runtime container lifecycle and port isolation. |
| **FR-SITE-05** | Python 3.12 Applications | MVP (M) | **Implemented** | `backend/src/sites/container-runner.ts` | `backend/test/m4-sites.test.ts` | Python environment initialization and WSGI launcher commands. |
| **FR-SITE-06** | Static HTML Sites | MVP (M) | **Implemented** | `backend/src/sites/site-service.ts` | `backend/test/m4-sites.test.ts` | Origin Nginx static document root scaffolding. |
| **FR-SITE-07** | Reverse-Proxy Sites | MVP (M) | **Implemented** | `backend/src/sites/site-service.ts`, `backend/src/edge/npm-client.ts` | `backend/test/m3-npm-edge.test.ts` | Skips origin container; forwards directly to external/container upstream, enforces R1 forward_host rule. |
| **FR-SITE-08** | Docker-App Sites | v1.1 (S) | **Missing** | Roadmap Phase 2 | Scheduled for v1.1 | Out of scope for v1.0 MVP. |
| **FR-SITE-09** | Git Deploy + Rollback | v1.1 (S) | **Missing** | Roadmap Phase 2 | Scheduled for v1.1 | Out of scope for v1.0 MVP. |
| **FR-SITE-10** | Site List & Search | MVP (M) | **Implemented** | `backend/src/api/v1/sites.routes.ts`, `frontend/src/components/SitesView.tsx` | `backend/test/m4-sites.test.ts` | Filtering, search, and scoped role visibility. |
| **FR-SITE-11** | Domain Rename / Alias | MVP (M) | **Implemented** | `backend/src/sites/site-service.ts` | `backend/test/m4-sites.test.ts` | Updates origin vhost and syncs NPM proxy host. |
| **FR-SITE-12** | Soft Delete & Trash | MVP (M) | **Implemented** | `backend/src/sites/site-service.ts` | `backend/test/wordpress-workflow.test.ts` | Domain-typed confirmation, soft delete state, and restore from trash. |
| **FR-SITE-13** | Staging Clone | v1.1 (S) | **Missing** | Roadmap Phase 2 | Scheduled for v1.1 | Out of scope for v1.0 MVP. |
| **FR-PROXY-01** | External NPM API Client | MVP (M) | **Implemented** | `backend/src/edge/npm-client.ts` | `backend/test/m3-npm-edge.test.ts`, `m3-npm-live.test.ts` | JWT acquisition, health verification, NPM 2.16.0 connection. |
| **FR-PROXY-02** | Shared External Network | MVP (M) | **Implemented** | `docker/lab-compose.yml`, `scripts/install.sh` | `backend/test/m2-fixtures-lab.test.ts`, `m3-npm-live.test.ts` | Shared `proxy` Docker network validation. |
| **FR-PROXY-03** | Proxy Host Lifecycle via API | MVP (M) | **Implemented** | `backend/src/edge/edge-provider.ts`, `npm-client.ts` | `backend/test/m3-npm-edge.test.ts`, `m3-npm-live.test.ts` | Creates, updates, disables, and deletes proxy hosts via REST API. |
| **FR-PROXY-04** | Forward Host Validation | MVP (M) | **Implemented** | `backend/src/edge/edge-provider.ts`, `npm-client.ts` | `backend/test/m3-npm-edge.test.ts` | Strict rejection of `localhost` and `127.0.0.1` with remediation tips. |
| **FR-PROXY-05** | SSL via NPM (HTTP-01 & DNS-01) | MVP (M) | **Implemented** | `backend/src/edge/npm-client.ts` | `backend/test/m3-npm-live.test.ts` | Certificate provisioning and binding via NPM API. |
| **FR-PROXY-06** | NPM Access Lists (Basic Auth) | MVP (M) | **Implemented** | `backend/src/edge/npm-client.ts` | `backend/test/m3-npm-live.test.ts` | Access list creation, user credentials, and host attachment. |
| **FR-PROXY-07** | NPM Down Queue & Drift Reconciler | MVP (M) | **Implemented** | `backend/src/edge/proxy-queue.ts`, `drift-reconciler.ts` | `backend/test/m3-npm-edge.test.ts` | Queues mutations during NPM outages, drains on recovery, detects and fixes drift. |
| **FR-DB-01** | Pluggable Engine Registry | MVP (M) | **Implemented** | `backend/src/db-engines/engine-registry.ts` | `backend/test/m5-databases.test.ts` | Registers MySQL, MariaDB, and PostgreSQL engines. |
| **FR-DB-02** | Engine Modes (internal/external/remote) | MVP (M) | **Implemented** | `backend/src/db-engines/engine-registry.ts` | `backend/test/m5-databases.test.ts` | Hard Rule R2 immutability guard: external engines cannot be stopped or deleted. |
| **FR-DB-03** | Atomic DB + User Provisioning | MVP (M) | **Implemented** | `backend/src/db-engines/db-provisioner.ts` | `backend/test/m5-databases.test.ts`, `wordpress-workflow.test.ts` | Atomic database and user creation; blocks WordPress on PostgreSQL. |
| **FR-DB-05** | Database Tool SSO | MVP (M) | **Implemented** | `backend/src/db-engines/engine-registry.ts` | `backend/test/m5-databases.test.ts` | Short-lived single-sign-on tokens without credentials in URLs. |
| **FR-DB-06** | SQL Import & Export | MVP (M) | **Implemented** | `backend/src/db-engines/engine-client.ts`, `dump-service.ts` | `backend/test/m5-databases.test.ts` | Background job execution with progress tracking and streaming dump handling. |
| **FR-DB-07** | Nightly Dumps & Retention | MVP (M) | **Implemented** | `backend/src/db-engines/dump-service.ts` | `backend/test/m5-databases.test.ts` | Nightly automated dumps with 7-day retention pruning. |
| **FR-DB-09** | Engine Migration Wizard | v1.1 (S) | **Missing** | Roadmap Phase 2 | Scheduled for v1.1 | Out of scope for v1.0 MVP. |
| **FR-DB-11** | Redis Configuration & Flush | MVP (M) | **Implemented** | `backend/src/db-engines/redis-client.ts` | `backend/test/m5-databases.test.ts` | Per-site Redis index isolation and flush capability. |
| **FR-DB-12** | Database User Management | MVP (M) | **Implemented** | `backend/src/db-engines/engine-client.ts` | `backend/test/m5-databases.test.ts` | User creation, password updates, and privilege revocation. |
| **FR-FILE-01** | File Manager & Path Security | MVP (M) | **Implemented** | `backend/src/files/file-service.ts` | `backend/test/security-regressions.test.ts` | Sibling directory traversal defense and canonical symlink escape blocks. |
| **FR-FILE-02** | SFTP Users Per Site | MVP (M) | **Implemented** | `backend/src/files/file-service.ts` | `backend/test/m4-sites.test.ts` | Per-site SFTP identity and chroot boundary setup. |
| **FR-PHP-01** | Per-Site PHP Settings | MVP (M) | **Implemented** | `backend/src/sites/vhost-generator.ts` | `backend/test/m4-sites.test.ts` | FastCGI parameter overrides and pool reload. |
| **FR-PHP-02** | Vhost Editor & Nginx Syntax Gate | MVP (M) | **Implemented** | `backend/src/sites/vhost-generator.ts` | `backend/test/m4-sites.test.ts` | Atomic validation with `nginx -t` before activation. |
| **FR-PHP-03** | Varnish Cache Support | MVP (M) | **Implemented** | `backend/src/sites/vhost-generator.ts` | `backend/test/m4-sites.test.ts` | Varnish reverse caching headers and preset exclusions. |
| **FR-CRON-01** | Site-Isolated Cron | MVP (M) | **Implemented** | `backend/src/cron/cron-service.ts` | `backend/test/m4-sites.test.ts` | Schedule parsing, validation, and containerized execution. |
| **FR-LOG-01** | Per-Site Log Aggregation | MVP (M) | **Implemented** | `backend/src/sites/site-service.ts` | `backend/test/m4-sites.test.ts` | Nginx, PHP-FPM, and application log streaming and filtering. |
| **FR-SVC-01** | Services Status & Health | MVP (M) | **Implemented** | `backend/src/api/v1/health.routes.ts` | `backend/test/m1-integration.test.ts` | System component readiness checks. |
| **FR-SEC-01** | 2FA & Brute Force Lockout | MVP (M) | **Implemented** | `backend/src/auth/auth-service.ts`, `jwt.ts` | `backend/test/security-regressions.test.ts` | 2FA challenge token scope isolation, recovery code hashing/consumption, IP lockout. |
| **FR-SEC-03** | Host UFW Firewall UI | MVP (M) | **Implemented** | `backend/src/security/firewall-manager.ts` | `backend/test/m6-security-backups.test.ts` | UFW rule generation and host port bypass warnings. |
| **FR-SEC-04** | Per-Site WAF & Cloudflare-Only | MVP (M) | **Implemented** | `backend/src/security/firewall-manager.ts` | `backend/test/m6-security-backups.test.ts` | CIDR IP blocking, bot protection, and Cloudflare origin restriction. |
| **FR-SEC-06** | Multi-Role RBAC & Resource Auth | MVP (M) | **Implemented** | `backend/src/api/plugins/auth-guard.ts`, `rbac/rbac.ts` | `backend/test/security-regressions.test.ts` | Enforces Admin, Site Manager, User, Client permissions with resource-aware ID ownership. |
| **FR-SEC-07** | AES-256-GCM Vault & Sanitization | MVP (M) | **Implemented** | `backend/src/vault/vault.ts` | `backend/test/vault.test.ts`, `security-regressions.test.ts` | Authenticated encryption at rest, 0600 file permissions, deep secret sanitization in logs. |
| **FR-BKP-01** | Remote Backups via Rclone | MVP (M) | **Implemented** | `backend/src/backups/backup-service.ts` | `backend/test/m6-security-backups.test.ts` | S3/remote storage destinations, encrypted credentials. |
| **FR-BKP-02** | 1-Click Site Restore | MVP (M) | **Implemented** | `backend/src/backups/restore-service.ts` | `backend/test/wordpress-workflow.test.ts` | Pre-restore safety snapshot, dump-to-database mapping, atomic extraction. |
| **FR-BKP-05** | Panel Self-Backup & Disaster Recovery | MVP (M) | **Implemented** | `backend/src/backups/self-backup-service.ts` | `backend/test/m6-security-backups.test.ts` | Metadata and Vault key backup and disaster recovery restore. |
| **FR-USR-03** | REST API v1 & Auth | MVP (M) | **Implemented** | `backend/src/api/v1/` | `backend/test/m1-integration.test.ts` | Versioned endpoints, Zod schema validation, sensible HTTP error codes. |
| **FR-USR-04** | CLI `nxctl` Tooling | MVP (M) | **Implemented** | `cli/src/bin/nxctl.ts`, `client.ts` | `cli/test/nxctl.test.ts` | Human-readable and structured `--json` mode for all operational commands. |
| **FR-IMP-01** | CloudPanel Sources (A, B, C) | MVP (M) | **Implemented** | `backend/src/importer/tar-inspector.ts`, `importer-service.ts` | `backend/test/m7-cloudpanel-import.test.ts` | Support for `backup.tar`, local pair (`.tar.gz` + `.sql.gz`), and live SSH. |
| **FR-IMP-02** | Import Wizard & Dry-Run Diff | MVP (M) | **Implemented** | `backend/src/importer/dry-run-simulator.ts` | `backend/test/m7-cloudpanel-import.test.ts` | Validates R1 forward host, R2 DB engine, and R3 WP on Postgres guard before execution. |
| **FR-IMP-03** | Import Fidelity & Verification | MVP (M) | **Implemented** | `backend/src/importer/import-executor.ts` | `backend/test/m7-cloudpanel-import.test.ts` | Awaits DB dump completion, recreates cron jobs, rewrites wp-config, executes HTTP check. |
| **FR-IMP-04** | 1-Click Rollback & Idempotency | MVP (M) | **Implemented** | `backend/src/importer/rollback-manager.ts` | `backend/test/m7-cloudpanel-import.test.ts` | Pre-import backup, clean compensation on failure, duplicate import guard. |

---

## 3. End-to-End Workflow Verification & Acceptance Status

While all core units, API guards, schemas, and test suites are green across the codebase, end-to-end operational workflows are classified below by their automated test status vs. live host environment verification.

Workflows that require live multi-container host orchestration (live PostgreSQL, live Docker daemon container spawning, live NPM proxy network routing, or live browser UI interaction) are marked **Partial** until verified on a dedicated staging/production host:

| Workflow | Description | Automated Suite Status | Live Host / Browser Status | Notes & Acceptance Criteria |
|---|---|---|---|---|
| **Workflow #1: Multi-DB Site Restore & Collision Safety** | Validates mapping of timestamped SQL dumps (`dump-<name>-<ts>.sql.gz`) back to matching databases, prevents silent overwrites to `siteDbs.rows[0]`, and halts with an explicit error on multiple candidate collisions. | **Implemented** (`security-regressions.test.ts`) | **Verified** | Manifest mapping, timestamp normalization, and collision rejection fully automated and verified. |
| **Workflow #2: WordPress Real Scaffolding & Live Lifecycle** | Generates real WordPress core files (`wp-login.php`, `wp-admin/index.php`, theme headers, salts, database tables), executes database provisioning before site record completion, and avoids FK violations. | **Implemented** (`wordpress-workflow.test.ts`) | **Partial** | File generation and database initialization pass in test harness. Full live verification of PHP-FPM origin container + NPM reverse proxy + live MySQL container is marked Partial pending live host validation. |
| **Workflow #3: Browser-Driven CloudPanel Import (Source A, B, C)** | Validates CloudPanel backup tarballs, displays dry-run diffs in frontend wizard, awaits asynchronous SQL import completion, and verifies HTTP site readiness without false-positive directory checks. | **Implemented** (`m7-cloudpanel-import.test.ts`) | **Partial** | Frontend and backend route schemas (`/detect` & `/cloudpanel`, `/execute` & `/run`) are aligned; false HTTP success on probe throw fixed. End-to-end browser execution with multi-gigabyte tarballs and live SSH is marked Partial until live test execution. |
| **Workflow #4: Disaster Recovery Panel Self-Restore** | Creates self-backup archives containing metadata and AES-256-GCM vault key, restores metadata inside a single atomic database transaction, and only updates `vault.key` upon complete transaction success. | **Implemented** (`security-regressions.test.ts`, `m6-security-backups.test.ts`) | **Partial** | Transactional safety and `.bak` rollback logic verified. Bare-metal recovery drill on fresh Linux host remains marked Partial. |
| **Workflow #5: 2FA / MFA Enrollment & Schema Upgrade** | Enforces separate token purposes (`access` vs `mfa_challenge`), prevents challenge tokens from accessing protected routes, hashes and consumes single-use recovery codes, and provides incremental database migration `005_user_recovery_codes.sql`. | **Implemented** (`security-regressions.test.ts`) | **Verified** | All token scope checks, recovery code validation, and migration column additions pass automated tests. |
