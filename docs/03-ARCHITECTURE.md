# 03 — Architecture

## 3.1 Principles

1. **Docker-native, single-host first.** Everything the panel manages is a container, a volume, or a network — except the host itself (Docker Engine, UFW, SSH). No host-level Nginx/PHP/MySQL installed by the panel.
2. **Edge is external.** The panel never binds 80/443. NPM is a peer, not a child.
3. **Adapters, not hard-coupling.** Edge (`EdgeProvider`), Database (`DatabaseEngine`), Storage (`BackupStorage`), and DNS-01 (`DnsProvider`) are interfaces. v1 ships NPM + MySQL/MariaDB/PostgreSQL + rclone. Traefik/Caddy, S3-native, Cloudflare DNS are later providers, not rewrites.
4. **API-first.** The web UI is a client of the same REST API the CLI uses. No UI-only logic.
5. **Jobs, not request-time work.** Anything > 5 s (site create, WP install, DB import, backup, import) is a background job with progress, logs, retry, and idempotency key.
6. **Reconciliation, not hope.** A scheduled reconciler diffs desired state (panel DB) vs actual state (NPM API, Docker, DB engines) and reports/fixes drift.

## 3.2 Component diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│  Internet ( :80 / :443 only )                                        │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  NPM container       │  jc21/nginx-proxy-manager:2.16.0
                    │  :80 :443 :81(admin)│  OpenResty + Certbot, SQLite/MySQL*
                    │  network: proxy      │  *NPM's own DB — separate from panel DB
                    └──────────┬──────────┘
                               │  external network `proxy` (external: true)
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
┌───────▼───────┐   ┌──────────▼───────┐   ┌──────────▼───────┐
│ Panel (NexPanel)│   │ Origin Nginx     │   │ Node / Python /  │
│  :8443 internal │   │ per PHP/static   │   │ Static / Docker  │
│  web + API +    │   │ site :8080 int.  │   │ app containers   │
│  worker + scheduler│  + PHP-FPM pool  │   │ :3000/:8000 int. │
└───────┬───────┘   └────────┬─────────┘   └──────────────────┘
        │                    │  sites network + proxy network
        │  ┌─────────────────┼─────────────────┐
        │  │                 │                 │
┌───────▼───────┐   ┌───────▼───────┐   ┌───────▼───────┐
│ Panel metadata │   │ Site DB engines │   │ Redis / Varnish │
│ PostgreSQL 16  │   │ MySQL 8.4 /     │   │ per-site or     │
│ (internal-docker│   │ MariaDB 12.3 /  │   │ shared, internal│
│  or remote)    │   │ PostgreSQL 16/17│   │ or external     │
└───────────────┘   │ internal-docker │   └─────────────────┘
                    │ external-docker │
                    │ external-remote │
                    └─────────────────┘
        │
┌───────▼───────┐
│ Backup storage│  rclone: S3 / Wasabi / DO / Dropbox / GDrive /
│ (remote)      │  Hetzner / SFTP / custom — panel + site backups
└───────────────┘
```

### 3.2.1 Panel internals (one logical service, deployable as 3 containers)

| Container | Responsibility | Tech (recommended, decision D-04) |
|---|---|---|
| `nexpanel-web` | HTTP UI + REST API, auth, RBAC, audit | Node.js 22 + TypeScript + Fastify (or Go — see D-04); React + Tailwind UI |
| `nexpanel-worker` | Background jobs (site create, WP install, DB import/export, backup, CloudPanel import, cron runner) — queue-backed | Same runtime as web; BullMQ / pg-boss on PostgreSQL, or Redis queue |
| `nexpanel-scheduler` | Cron triggers, nightly dumps, SSL-expiry checks, NPM reconciliation, CF IP sync | Same runtime; cron inside worker or a small scheduler container |
| `nexpanel-db` | Panel metadata only | PostgreSQL 16, volume `nexpanel-db-data` |
| `nexpanel-redis` (optional) | Job queue + cache + sessions (if not using Postgres for queue) | Redis 8, internal-docker |

The web container must be stateless (sessions in Redis/Postgres, uploads to a shared volume / S3) so it can be restarted without losing work.

### 3.2.2 Why PostgreSQL for panel metadata (not MySQL)

- The panel's metadata is relational + JSONB (site config, job payloads, audit) — Postgres JSONB + strong constraints fit it.
- It proves the panel is DB-agnostic: if the panel itself can run on Postgres while sites run on MySQL, no code path can assume MySQL.
- It avoids confusing "panel DB" with "site DB" — a common CloudPanel support issue.

## 3.3 External NPM — detailed design

### 3.3.1 Topology & networks

```yaml
# Reference — full file in examples/docker-compose.example.yml
networks:
  proxy:
    name: proxy
    external: true        # created once: docker network create proxy
  sites:
    name: nexpanel-sites
    driver: bridge
  panel:
    name: nexpanel-panel
    driver: bridge
```

- **NPM** joins `proxy` only (plus its own internal net if needed). Ports `80:80`, `443:443`, `127.0.0.1:81:81` (admin UI loopback-only by default — see §3.3.4).
- **Panel** joins `proxy` + `panel`. It reaches NPM API at `http://npm:81/api` (container name) or the user-configured base URL.
- **Every site origin/app** joins `proxy` + `sites`. It must NOT publish host ports. `expose:` only.
- **DB engines (internal-docker)** join `sites` only — never `proxy`. They are not reachable from the internet or NPM.
- **External DBs** are reached by host:port / container name on a network the panel joins (for external-docker on the same host, the panel joins that DB's network, or the DB joins `sites`).

### 3.3.2 NPM API contract (what the panel uses)

Base: `<npm-base-url>/api` — JWT from `POST /api/tokens` (email + password). Token stored encrypted, refreshed on 401.

| Panel action | NPM API |
|---|---|
| List / verify connection | `GET /api/` (health), `GET /api/nginx/proxy-hosts` |
| Create proxy host | `POST /api/nginx/proxy-hosts` — `{domain_names:[], forward_scheme:"http", forward_host:"<container>", forward_port:8080, access_list_id:0, certificate_id:0|"new", ssl_forced, hsts_enabled, http2_support, websocket_support, block_exploits, caching_enabled, allow_websocket_upgrade}` |
| Update / enable / disable / delete host | `PUT /api/nginx/proxy-hosts/:id`, `POST /api/nginx/proxy-hosts/:id/disable`, `POST .../enable`, `DELETE ...` |
| Certificates — list / request LE / upload custom | `GET /api/nginx/certificates`, `POST /api/nginx/certificates` (`provider:"letsencrypt"`, `domain_names`, `meta:{letsencrypt_email, letsencrypt_agree, dns_challenge}`), upload via `POST /api/nginx/certificates/:id/upload` (cert + key) |
| Access lists | `GET/POST/PUT/DELETE /api/nginx/access-lists`, items: `{username, password}` + clients `{address, directive:"allow"\|"deny"}` |
| Redirection / 404 / streams | `POST /api/nginx/redirection-hosts`, `/api/nginx/dead-hosts`, `/api/nginx/streams` |
| Users (NPM admin users) | `GET /api/users` — panel does NOT manage NPM users in v1 except to verify the service account exists |

**Rules:**
- Every NPM mutation is wrapped in a panel job with an idempotency key (`site_id + action + hash`). Retrying a job must not create a duplicate host.
- Every NPM call is logged (method, path, status, duration — never the JWT or password).
- If NPM returns 400 on a cert request (e.g. DNS not pointing at the server), the panel surfaces NPM's message verbatim + a "Check DNS" hint. It does not guess.
- The panel never writes to NPM's `/data` volume or its SQLite DB directly. If the API cannot do something, that thing is out of scope until NPM adds it.

### 3.3.3 SSL flow (who does what)

```
User creates site example.com
  → panel creates origin + (if "Issue SSL" ticked) calls NPM:
      POST /api/nginx/certificates {letsencrypt, domain_names:[example.com, www.example.com]}
      → NPM/Certbot does HTTP-01 via :80 (must be open + DNS pointing at server)
      → on success, panel sets proxy host certificate_id = new cert, ssl_forced=true
  → if DNS-01: panel passes dns_challenge=true + provider + credentials (stored encrypted, scoped to that cert)
  → if custom: user uploads .crt + .key (+ chain) → panel uploads to NPM
Renewal: NPM renews automatically. Panel polls cert expiry daily; if a cert is < 14 days and not renewed, it alerts + offers "Retry renewal" (re-POST the cert request).
```

**Conflict rule:** the panel must never also run Certbot on the host. Port 80 is NPM's. Any docs/runbook that suggests `certbot` on the host is a bug.

### 3.3.4 Securing NPM itself

- Admin UI `:81` bound to `127.0.0.1` by default; access via SSH tunnel (`ssh -L 8081:127.0.0.1:81`) or via a panel-created NPM proxy host with an access list (recommended: `npm.example.com` + basic-auth + IP allow).
- First-run: NPM 2.16 has no default `admin@example.com/changeme` — the installer creates the admin account on first run. The panel installer must handle this (prompt for NPM admin email/password, create the account, store it encrypted).
- TOTP 2FA on the NPM admin account is recommended and surfaced in the panel's security score.

### 3.3.5 If NPM is replaced (future)

`EdgeProvider` interface (TypeScript sketch — normative for the build, not pseudocode to copy blindly):

```ts
interface EdgeProvider {
  readonly kind: "npm" | "traefik" | "caddy";
  verifyConnection(): Promise<{ ok: boolean; version?: string; error?: string }>;
  createHost(input: ProxyHostInput): Promise<{ edgeId: string }>;
  updateHost(edgeId: string, input: Partial<ProxyHostInput>): Promise<void>;
  deleteHost(edgeId: string): Promise<void>;
  setHostEnabled(edgeId: string, enabled: boolean): Promise<void>;
  requestCertificate(input: CertInput): Promise<{ edgeCertId: string; expiresAt?: string }>;
  uploadCertificate(input: CustomCertInput): Promise<{ edgeCertId: string }>;
  listCertificates(): Promise<EdgeCertificate[]>;
  createAccessList(input: AccessListInput): Promise<{ edgeId: string }>;
  listHosts(): Promise<EdgeHost[]>; // for reconciliation
}
```

## 3.4 External databases — detailed design

### 3.4.1 Engine record

```ts
type DbEngineMode = "internal-docker" | "external-docker" | "external-remote";
type DbEngineType = "mysql" | "mariadb" | "postgresql";

interface DbEngine {
  id: string;
  name: string;                 // "Internal MySQL 8.4", "External MySQL (docker)", "RDS Prod"
  type: DbEngineType;
  version: string;              // "8.4", "12.3", "16"
  mode: DbEngineMode;
  // internal-docker:
  containerName?: string; image?: string; volume?: string; internalPort?: number;
  // external-docker:
  externalContainerName?: string; network?: string;
  // external-remote:
  host?: string; port?: number; tls?: boolean; tlsCa?: string; // stored encrypted
  rootUsername: string;         // root / admin user for provisioning
  // root password / credentials: encrypted in vault, never in this record's plaintext
  isDefault: boolean;
  status: "unknown" | "reachable" | "unreachable";
  lastCheckedAt?: string;
}
```

### 3.4.2 Provisioning flow (per engine type)

| Mode | Create DB + user | Delete DB | Restart / upgrade | Backup |
|---|---|---|---|---|
| internal-docker | Panel connects to the container (via `sites` net, `mysql -h <container>`) and runs `CREATE DATABASE` / `CREATE USER` / `GRANT`. Panel may restart/upgrade the container. | `DROP DATABASE` + `DROP USER` (with confirm). | Panel-managed. | `mysqldump` / `pg_dump` from the panel worker (via network, not host shell). |
| external-docker | Same SQL, via container name on the shared network. Panel **must not** restart, stop, delete, or upgrade the container. UI disables those buttons with "External — managed outside NexPanel". | Same SQL. Container untouched. | Disabled. | Same dump via network. |
| external-remote | Same SQL over TCP/TLS to host:port. Panel never touches the host. | Same SQL. | Disabled. | Same dump over TCP/TLS. |

**Safety:** `DROP DATABASE` and `DROP USER` always require typing the DB name + a second confirm if the DB is linked to a live site. The panel keeps a 7-day trash snapshot (dump) before a destructive DB delete.

### 3.4.3 MySQL vs MariaDB vs PostgreSQL — what differs

- **MySQL 8.4 / MariaDB 12.3:** `mysql` protocol, `mysqldump`/`mariadb-dump`, phpMyAdmin, `CREATE USER ... IDENTIFIED BY`, grants. MariaDB auth plugins differ — the panel detects the server version and uses the right syntax; it does not assume MySQL 8 `caching_sha2_password`.
- **PostgreSQL 16/17:** `pg` protocol, `pg_dump`/`pg_restore`, roles instead of users, `GRANT CONNECT / SELECT, INSERT…`, pgAdmin/Adminer. WordPress on Postgres is not native — the panel warns when a WP site picks Postgres ("WordPress requires a Postgres compatibility layer — not recommended; use MySQL/MariaDB") and blocks it by default (override with a checkbox + warning).
- **Charset/collation defaults:** MySQL `utf8mb4` / `utf8mb4_unicode_ci`, MariaDB same, Postgres `UTF8`. Stored per DB, shown in UI.

### 3.4.4 Internal MySQL Docker — the toggle Larry asked for

In Admin → Database Engines, each internal engine has an **Enabled** toggle:

- **Enabled:** container runs, health-checked, sites can use it. This is the "enable the docker and use internal MySQL" path.
- **Disabled:** container stopped (data volume kept), no new DBs on it, existing sites show a warning ("Engine disabled — site DB unreachable until re-enabled or migrated"). Re-enable restarts it.
- The panel ships with **one** internal engine enabled by default (MySQL 8.4) and the others available to enable. Enabling a second internal engine pulls its image on demand.

## 3.5 Site runtime — per-type origin

| Site type | Origin | Container(s) per site | Networks | Internal port |
|---|---|---|---|---|
| WordPress / PHP | Origin Nginx + PHP-FPM pool | `site-<slug>-web` (nginx:alpine + vhost), `site-<slug>-php` (php:<ver>-fpm) | `proxy` (web only), `sites` (both) | web :8080 |
| Node.js | App container (+ optional PM2 inside) | `site-<slug>-app` (node:<ver>) | `proxy` + `sites` | app port (e.g. 3000) |
| Python | App container (gunicorn/uvicorn) | `site-<slug>-app` (python:3.12) | `proxy` + `sites` | app port (e.g. 8000) |
| Static | Origin Nginx only | `site-<slug>-web` (nginx:alpine) | `proxy` + `sites` | :8080 |
| Reverse proxy | None (NPM only) | — | — | — |
| Docker-app | User's image | `site-<slug>-app` (user image) | `proxy` + `sites` | user port |

Volumes: `/data/sites/<slug>/htdocs` (or `/app`), `/data/sites/<slug>/logs`, `/data/sites/<slug>/backups`. UID/GID: per-site Linux UID in VM mode; in Docker mode, a per-site UID mapped into the container (`user: "1001:1001"`) so files on the host are owned per-site and not world-readable.

## 3.6 Data flow — create a WordPress site (happy path)

```
1. UI → POST /api/v1/sites {domain, type:"wordpress", phpVersion:"8.3", dbEngineId, ...}
2. API validates (domain syntax, DNS hint, engine reachable, quota) → creates Site row (status: provisioning) + Job (idempotency key)
3. Worker:
   a. Create volume dirs + site UID
   b. Start origin Nginx + PHP-FPM containers (pull images if needed)
   c. Create DB + user on the chosen engine (FR-DB-03)
   d. Download + install WordPress (WP-CLI in a one-shot container), write wp-config.php with DB creds
   e. Write origin vhost from template → nginx -t → reload
   f. Call NPM API: create proxy host (forward_host=site-<slug>-web, port 8080)
   g. If SSL requested: request cert via NPM → attach to host → ssl_forced=true
   h. Enable Varnish/Redis if ticked; create cron entries; schedule nightly DB dump
4. Job completes → Site status: live → Dashboard shows it, audit log written
5. Any step fails → job marks failed, compensating actions run (delete NPM host if created, stop containers, drop DB if created and flag says so), error shown with the exact step + logs + "Retry" / "Delete partial site"
```

## 3.7 Security architecture

- **Network segmentation:** `proxy` (edge only), `sites` (origins + DBs), `panel` (panel + its DB). A site container cannot reach the panel DB; a DB container cannot reach the internet (no published ports, egress restricted by firewall where possible).
- **Secrets:** vault file (`/data/panel/vault.key`, 0600, generated at install) + AES-256-GCM for all stored credentials. Rotation: re-encrypt with a new key, old key kept for 7 days for rollback.
- **Auth:** JWT (short-lived access + refresh), TOTP, API tokens (scoped, revocable, last-used shown). Passwords: Argon2id.
- **No secrets in:** logs, audit `before/after`, URLs, Docker labels, `docker inspect` output (use Docker secrets / env files with 0600, not `-e` on the command line in a way that lands in shell history — use `--env-file`).
- **Backups:** encrypted at rest if the destination supports it (rclone crypt), otherwise warn.

## 3.8 Scalability & multi-host (v2 constraint, not v1 build)

- v1 is single-host Docker. The data model must not assume single-host: `Site.hostId`, `DbEngine.hostId`, `EdgeProvider.hostId` exist from day 1, even if v1 only ever has `host-1`.
- v2 adds: a second host (agent on the host, panel orchestrates via API), shared storage or per-host volumes, and a load-balancer mode for NPM (multiple NPMs behind a floating IP — out of v1 scope, design must not block it).
- Do not design a v1 schema that would need a migration to add `hostId` later.

## 3.9 Technology recommendations (for decision D-04)

| Layer | Recommended | Alternative | Why recommended |
|---|---|---|---|
| Panel backend | Node.js 22 + TypeScript + Fastify | Go 1.23 + Echo | Team familiarity (Larry's apps are JS/TS), huge Docker/NPM API ecosystem, Fastify is fast enough for a panel |
| Panel frontend | React 19 + Tailwind + Vite, in the same repo | Vue / Svelte | Same language as backend, component ecosystem |
| Panel metadata DB | PostgreSQL 16 | MySQL 8.4 | §3.2.2 |
| Job queue | pg-boss (on Postgres) — one less service | BullMQ + Redis | Fewer moving parts in MVP; Redis still exists for caching |
| File manager backend | Panel API + volume mounts (no separate service) | FileBrowser container per site | Simpler permissions; FileBrowser can be added as an optional per-site tool in v1.1 |
| WP install | WP-CLI in a one-shot container | Direct PHP script | WP-CLI is the standard, scriptable, testable |
| Backups | rclone (same as CloudPanel) + `mysqldump`/`pg_dump` | restic | rclone matches CloudPanel destinations; restic is a v1.1 option for incremental |
| Reverse proxy | NPM 2.16.0 (external) | Traefik (later provider) | Larry's explicit requirement |
