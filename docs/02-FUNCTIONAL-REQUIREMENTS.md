# 02 — Functional Requirements

> Priority: **M** = MVP blocker, **S** = v1.1, **C** = v2 / nice-to-have, **W** = out of scope.
> Type: `PARITY` = CloudPanel has it, `BETTER` = beat CloudPanel, `NEW` = no CloudPanel equivalent.
> Each FR has an acceptance test (AC). A feature is not "done" until its AC passes on a real install.

## 2.1 Sites — core

| ID | Requirement | Pri | Type | Acceptance |
|---|---|---|---|---|
| FR-SITE-01 | Create a site from 6 types: WordPress, PHP, Node.js, Python, Static HTML, Reverse Proxy. Each gets its own isolated identity (UID, home/volume, PHP-FPM pool or app container, DB namespace). | M | PARITY | Create one of each type; files of site A are not readable by site B's user/container (test `su` / volume mount check). |
| FR-SITE-02 | WordPress install: choose version (latest / pinned), admin user/pass/email, site title, language; panel creates DB + user, installs WP, issues SSL if domain resolves. Install completes in < 5 min on a 2 GB VPS. | M | PARITY | Fresh WP install loads, `wp-admin` login works, DB tables exist. |
| FR-SITE-03 | PHP site: choose PHP 7.1–8.5 per site, document root (`htdocs/<domain>` or custom), vhost template (WordPress / Laravel / Symfony / generic PHP / custom). Switch PHP version without recreating the site; switch is < 60 s and old pool is stopped. | M | PARITY | Switch 8.2 → 8.3, `phpinfo()` shows 8.3, no downtime > 60 s, old FPM pool gone. |
| FR-SITE-04 | Node.js site: choose Node 16/18/20/22/24, app entry (`app.js` / `server.js` / custom), port (internal only), start command, env vars, PM2-equivalent process manager (auto-restart, logs). | M | PARITY | Node app responds via NPM host; `kill` the process → auto-restart < 10 s; logs visible. |
| FR-SITE-05 | Python site: choose Python 3.12 (3.13/3.14 where OS supports), framework (Django / Flask / FastAPI / generic WSGI/ASGI), entry, port, venv, requirements install, uWSGI/Gunicorn equivalent. | M | PARITY | Django/Flask sample responds; `pip install -r requirements.txt` runs from panel. |
| FR-SITE-06 | Static site: upload ZIP / drag-drop / Git pull to document root; served by origin Nginx; no PHP pool. | M | PARITY | Upload `index.html` ZIP → site serves it via HTTPS. |
| FR-SITE-07 | Reverse-proxy site: domain → arbitrary upstream (`http(s)://host:port` or container name on `proxy` net). No origin created. WebSocket toggle, custom headers. | M | PARITY | Proxy to `http://192.168.1.50:8096` and to a container name both work; WS toggle fixes a live WS app. |
| FR-SITE-08 | **Docker-app site (NEW):** attach any Docker Compose service / image as a site: image, internal port, env, volumes, restart policy. Panel gives it a domain via NPM and shows logs/stats. | S | NEW | Deploy `uptime-kuma:3001` as a site via UI; domain works; stop/start/restart from panel. |
| FR-SITE-09 | **Git-deploy site (BETTER):** connect a Git repo (HTTPS + token / SSH key), branch, deploy on push (webhook) or manual Deploy button; show commit + deploy history; rollback to previous deploy. | S | BETTER | Push to `main` → site updates < 2 min; rollback restores previous commit's files. |
| FR-SITE-10 | Site list: search, filter by type/PHP/status, sort, bulk enable/disable/delete; per-site status (online / SSL expiring / error / deploying). | M | PARITY | 30 sites listed, search finds one in < 1 s, bulk disable works. |
| FR-SITE-11 | Site settings: rename domain (with redirect old → new option), change document root, change PHP/Node/Python version, toggle Varnish/Redis, toggle maintenance mode (503 page). | M | PARITY | Rename domain → old domain 301s, new domain serves, NPM host updated, no manual Nginx edit. |
| FR-SITE-12 | Delete site: confirm with typed domain, options: keep/delete files, keep/delete DBs, revoke NPM host + cert. Deletion is reversible for 7 days via trash (files+DB snapshot). | M | BETTER | Delete → trash shows site; restore within 7 days brings back files + DB + NPM host. |
| FR-SITE-13 | **Staging clone (BETTER):** 1-click clone site → `staging.<domain>` (files + DB copy + search-replace URLs), with "Push staging → live" (files + DB, with backup of live first). | S | BETTER | Clone WP, edit staging, push → live matches staging, live backup exists before push. |
| FR-SITE-14 | Domain aliases: add `www` + custom aliases per site; each alias gets SSL (SAN or separate cert via NPM) and can 301 to primary. | M | PARITY | Add `www` + `shop.example.com` → both serve, both HTTPS. |
| FR-SITE-15 | Site notes / tags / client assignment: free-text notes, tags, assign to a Client/User. | S | NEW | Filter sites by tag/client. |

## 2.2 Reverse proxy — external NPM (the R1 feature)

| ID | Requirement | Pri | Type | Acceptance |
|---|---|---|---|---|
| FR-PROXY-01 | **NPM connection:** Admin registers an NPM instance: base URL (e.g. `http://npm:81` or `https://npm.example.com:81`), admin email + password or API token, verify-connection button. Panel stores credentials encrypted (vault, never plaintext in DB dump). | M | NEW | Connect to a fresh NPM 2.16.0, verify passes, wrong password fails with clear error. |
| FR-PROXY-02 | **Shared external network:** installer creates (or joins) an external Docker network named `proxy` (configurable, default `proxy`). Panel, NPM and every site origin/app join it. Panel validates on startup: NPM is on the network, else shows a blocking warning with the fix command. | M | NEW | `docker network inspect proxy` shows NPM + panel + site containers; a site not on the net shows a health error, not a silent 502. |
| FR-PROXY-03 | **Proxy-host lifecycle via NPM API:** creating a site creates an NPM proxy host (domain(s) → `forward_host` = origin container name, `forward_port` = internal port, `forward_scheme` = http). Deleting/disabling a site disables/deletes the NPM host. All via `POST/PUT/DELETE /api/nginx/proxy-hosts` with JWT. No direct edit of NPM's SQLite or Nginx files. | M | NEW | Create site → `GET /api/nginx/proxy-hosts` shows it; delete site → host gone; panel log shows the API calls. |
| FR-PROXY-04 | **Forward-host resolution:** `forward_host` must be a container name on the shared network, never `localhost` (which inside NPM means NPM itself → 502). Panel validates and rejects `localhost`/`127.0.0.1` with guidance. | M | NEW | Attempting `localhost` is rejected in UI + API with "use container name" message. |
| FR-PROXY-05 | **SSL via NPM:** per host: (a) request new Let's Encrypt cert (HTTP-01), (b) DNS-01 with provider + credentials (Cloudflare, Route53, OVH, etc. — at least Cloudflare + Route53 in MVP), (c) wildcard, (d) upload custom cert + key + chain, (e) Force SSL, HTTP/2, HSTS. Auto-renew is NPM's job; panel surfaces expiry + renewal failures. | M | PARITY/BETTER | Issue LE cert for a real domain via HTTP-01; wildcard via Cloudflare DNS-01; custom cert upload works; expiry alert fires. |
| FR-PROXY-06 | **Access lists:** create NPM access lists (basic-auth users + IP allow/deny, satisfy any/all) and attach to a host; per-path access lists (NPM 2.16.0). Used for staging, panel admin, and "Basic Auth" per site. | M | PARITY/BETTER | Lock staging with basic auth + IP allow; public site unaffected. |
| FR-PROXY-07 | **NPM down / drift handling:** if NPM API is unreachable, panel shows a banner, queues proxy changes, retries with backoff, and never deletes local site state. A nightly reconciliation job diffs panel-expected hosts vs NPM actual hosts and reports drift (missing/extra/changed) with 1-click "Reconcile". | M | NEW | Stop NPM → create site → queued; start NPM → queue drains; manually delete a host in NPM UI → drift report shows it. |
| FR-PROXY-08 | **Other NPM objects:** redirection hosts (301), 404 hosts, TCP/UDP streams — creatable from panel (at least redirection + streams in MVP). | S | NEW | Create a 301 `old.com → new.com` and a TCP stream in panel; both appear in NPM. |
| FR-PROXY-09 | **Custom Nginx config per host:** advanced tab for raw NPM "Advanced" + "Custom Locations" (`/api` → another upstream, headers, `client_max_body_size`). Validated with `nginx -t` via NPM API error handling; invalid config is rejected, not applied. | S | BETTER | Add `/api` location; invalid snippet is rejected with NPM's error. |
| FR-PROXY-10 | **Edge adapter interface:** proxy logic is behind an `EdgeProvider` interface (`NpmEdgeProvider` in v1). A future Traefik/Caddy provider implements the same methods (create/delete host, cert, access list). No site code calls NPM directly. | M | NEW | Code review: only `EdgeProvider` module imports NPM client; adding a stub Traefik provider compiles. |
| FR-PROXY-11 | **Panel's own domain:** panel is itself a proxy host in NPM (e.g. `panel.example.com`), with access list + 2FA, not exposed on a raw port. Installer offers to create it. | M | NEW | Panel reachable only via NPM host; direct `:8443` from internet is blocked by firewall default. |

## 2.3 Databases — external engines (the R2 feature)

| ID | Requirement | Pri | Type | Acceptance |
|---|---|---|---|---|
| FR-DB-01 | **Engine registry:** Admin → Database Engines: list engines with type, mode, host/port, version, status (reachable, latency, disk). Engine types in MVP: MySQL 8.0/8.4, MariaDB 10.11/11.8/12.3, PostgreSQL 16/17. | M | NEW | Register all three types; health check shows green/red per engine. |
| FR-DB-02 | **Engine modes:** per engine, mode = `internal-docker` (panel creates/manages the container: image, volume, port internal-only, root password in vault, auto-start) **or** `external-docker` (user supplies container name + network + credentials; panel only connects, never restarts/deletes it) **or** `external-remote` (host:port, TLS optional, credentials). Mode is shown everywhere and destructive actions are disabled for external modes. | M | NEW | Create an internal MySQL + connect an external MySQL Docker + a remote MariaDB; all three serve sites. |
| FR-DB-03 | **Create DB + user in one form (per site):** DB name, user, password (generate strong), host (`%` / localhost / specific), privileges: Read+Write / Read-Only / custom. Panel creates DB + user + grants on the site's engine via that engine's protocol, never via shell `mysql` on the panel host unless the engine is internal-docker. | M | PARITY | Create DB+user; app connects with those creds; read-only user cannot `INSERT` (tested). |
| FR-DB-04 | **Per-site engine choice:** when creating a site, choose which engine its DB lives on (default = server default engine). A site's DBs can live on different engines. Changing a site's default engine does not move existing DBs (move is explicit, FR-DB-09). | M | NEW | Site A on internal MySQL, Site B on external PostgreSQL, both from the same wizard. |
| FR-DB-05 | **DB tools SSO:** one-click phpMyAdmin (MySQL/MariaDB), Adminer (all engines), pgAdmin (PostgreSQL) — opened already logged in as the selected DB user, with a short-lived token, no password in URL. | M | PARITY | Click Manage → phpMyAdmin opens logged in as that user, no password prompt. |
| FR-DB-06 | **Import / Export:** import `.sql` / `.sql.gz` (up to 2 GB via chunked upload, larger via SFTP path), export `.sql.gz` with options (structure/data/both, gzip). Large imports run as a background job with progress, not a browser timeout. | M | PARITY | Import 500 MB dump via job; progress bar; export downloads correctly. |
| FR-DB-07 | **Nightly DB dumps:** every DB dumped nightly (default 03:15, configurable), gzip, retention 7 days default (configurable 1–90), stored in site's `backups/` + optionally to remote backup destination. Dump failure alerts Admin. | M | PARITY | Dump appears nightly; retention prunes day 8; failure email/webhook fires. |
| FR-DB-08 | **Remote DB servers (CloudPanel parity +):** add a remote DB server (RDS/Aurora/self-hosted) as an engine; panel tests connectivity + TLS + version before saving; firewall guidance shown. | M | PARITY | Add RDS MySQL; test passes; site uses it. |
| FR-DB-09 | **Engine migration wizard (BETTER):** move a DB `internal → external` (or reverse, or MySQL → MariaDB where compatible): dump → create on target → import → verify row counts + checksums → flip site config → keep old DB for 7 days as rollback. Dry-run first. | S | BETTER | Migrate a WP DB internal→external with zero data loss (row counts match, site loads). |
| FR-DB-10 | **PostgreSQL first-class:** WP/PHP sites that support Postgres can use it; Node/Python sites can use it natively; panel does not assume MySQL syntax for its own queries (parameterised, engine-aware). | S | NEW | Create a Postgres DB for a Node app; Adminer/pgAdmin work. |
| FR-DB-11 | **Redis:** per-site Redis DB index or separate Redis instance (internal-docker or external); memory cap, eviction policy, flush button, connection string shown. | M | PARITY | Enable Redis for WP → object-cache plugin connects; flush works. |
| FR-DB-12 | **DB users management:** list users per DB, change password, change privileges, delete user (with "in use by site" warning). | M | PARITY | Change password → site config is offered an update (or shows "update wp-config.php"). |

## 2.4 Files, SSH / SFTP / FTP

| ID | Requirement | Pri | Type | Acceptance |
|---|---|---|---|---|
| FR-FILE-01 | Web file manager: browse site home, upload (drag-drop, chunked > 2 GB), download, create/rename/move/delete, unzip, edit text files (syntax highlight), permissions (chmod) + ownership view, trash (restore 30 days). | M | PARITY | Upload 3 GB ZIP via chunks; edit `wp-config.php` in browser; delete → trash → restore. |
| FR-FILE-02 | SFTP/SSH users per site: add user (username, password or SSH key), home = site home, shell (bash / nologin / SFTP-only). Keys: paste / generate / revoke. | M | PARITY | SFTP login as site user lands in site home, cannot `cd /` to another site. |
| FR-FILE-03 | FTP (ProFTPD-compatible behaviour) is **optional and off by default** — SFTP is the default. If enabled, FTP is FTPS only (explicit TLS), no plaintext FTP on the internet. | S | PARITY | Enabling FTP requires TLS; plaintext FTP attempt fails. |
| FR-FILE-04 | File search: search by name/content within a site, with results + "open in editor". | S | NEW | Search `wp-config` finds the file in < 2 s on a 10k-file site. |
| FR-FILE-05 | Disk usage per site: files + DB + backups, with quota (soft limit + alert, hard limit optional). | S | BETTER | Set 5 GB quota → alert at 80%, hard block at 100% (configurable). |

## 2.5 PHP, Varnish, caching

| ID | Requirement | Pri | Type | Acceptance |
|---|---|---|---|---|
| FR-PHP-01 | Per-site PHP settings: `memory_limit`, `max_execution_time`, `upload_max_filesize`, `post_max_size`, `max_input_vars`, `display_errors`, `opcache` on/off, timezone, extensions enable/disable (from a curated list per version). Changes apply with FPM pool reload, no site recreate. | M | PARITY | Change `upload_max_filesize` 2M→64M → `phpinfo()` reflects it after reload. |
| FR-PHP-02 | Vhost editor: view/edit origin Nginx vhost for a site, with template selector (30+ templates: WordPress, WooCommerce, Laravel, Joomla, Moodle, etc.), syntax check (`nginx -t`) before save, version history + revert, diff preview. | M | PARITY | Edit vhost with a typo → rejected with `nginx -t` error, old vhost stays live. |
| FR-PHP-03 | Varnish per site: enable/disable, TTL, purge (all / by URL), exclude cart/checkout/account (WP presets), memory size. Requires WP plugin hook for auto-purge on publish (documented). | M | PARITY | Enable Varnish → `X-Cache: HIT` on second request; purge works. |
| FR-PHP-04 | **PHP as Docker images:** each PHP version is a container image (`php:8.3-fpm` + extensions layer). Adding a PHP version = pulling an image, not reinstalling the host. Panel shows installed vs available versions. | M | NEW | Add PHP 8.5 by pulling image; site switches to it without host changes. |

## 2.6 Cron, logs, services

| ID | Requirement | Pri | Type | Acceptance |
|---|---|---|---|---|
| FR-CRON-01 | Per-site cron: add/edit/delete/disable, schedule builder (presets: every minute/hour/day/week/month + cron expression with validation + next-run preview), command, run as site user, timeout, email on failure (optional). | M | PARITY | Add `*/15 * * * *` job → runs, next-run preview correct. |
| FR-CRON-02 | Cron run history: each run logged (start/end, exit code, stdout/stderr tail, duration); failure alert (panel + email/webhook); "Run now" button. | S | BETTER | Failed cron shows red, alert fires, "Run now" re-runs it. |
| FR-LOG-01 | Logs per site: Nginx access/error, PHP-FPM error, app logs (Node/Python), NPM access log for the host — view, live tail, search/filter, download, retention (default 14 days, configurable). | M | PARITY | Tail shows new lines live; search `500` filters correctly. |
| FR-SVC-01 | Services page: list all managed services/containers (NPM, origin Nginx, PHP-FPM pools, DB engines, Redis, Varnish, panel) with status, uptime, CPU/RAM, restart/stop/start, logs. | M | PARITY | Stop Redis → status red → start → green; panel never restarts an external DB. |
| FR-SVC-02 | Events / audit log: every mutation (site create, DB password change, NPM host delete, user login, import) logged with actor, IP, timestamp, before/after (no secrets). Filterable, exportable, retention 90 days default. | M | BETTER | Delete a site → audit shows who/when/IP; export CSV works. |

## 2.7 Security

| ID | Requirement | Pri | Type | Acceptance |
|---|---|---|---|---|
| FR-SEC-01 | Panel auth: email+password, TOTP 2FA (enforced for Admin by default, optional for others), session management (list/revoke sessions), brute-force lockout, password policy + breach check (optional). | M | PARITY | 2FA setup works; 5 failed logins lock the account for 15 min. |
| FR-SEC-02 | Panel Basic Auth (extra layer in front of panel login) — via NPM access list, toggleable, with username/password. | M | PARITY | Enable → panel login requires basic-auth first. |
| FR-SEC-03 | Firewall: UFW-compatible rules UI on VM/host (allow/deny port/IP/CIDR, presets for SSH/HTTP/HTTPS/panel/DB), plus Docker-aware note: published ports bypass UFW — panel warns when a site publishes a host port. Default: panel port only from Admin IPs if set, else warn. | M | PARITY | Add rule `allow 22 from 1.2.3.4` → applied; panel warns on a published host port. |
| FR-SEC-04 | Per-site security: IP block (v4/v6/CIDR), bot block (named bots + custom user-agent), Basic Auth for a site/staging, Cloudflare-only mode (allow only Cloudflare IPs, auto-updated list), security headers presets. | M | PARITY | Block an IP → 403; enable Cloudflare-only → direct IP request 403. |
| FR-SEC-05 | Cloudflare integration: API token, purge cache, toggle Development Mode, list zones, "Cloudflare-only" syncs CF IPs daily (06:00 cron). | S | PARITY | Purge CF cache from panel; CF IPs update. |
| FR-SEC-06 | Roles & permissions: Admin (all), Site Manager (all sites, no Admin Area), User (assigned sites only), Client (read-only + own sites, no delete/DB password view). Granular toggles in v1.1 (e.g. deploy vs delete). API tokens scoped per user. | M | PARITY/BETTER | User sees only assigned sites; Client cannot delete; Site Manager cannot open Admin Area. |
| FR-SEC-07 | Secrets: all passwords/tokens/keys encrypted at rest (AES-256-GCM, key in vault file with 0600, rotation supported), never in logs/URLs/exports, masked in UI (`••••••••` + Reveal with audit). | M | NEW | DB dump of panel DB contains no plaintext password; reveal is audited. |
| FR-SEC-08 | Security score per site: checks SSL expiry, 2FA, firewall, outdated PHP/WP, exposed `.env`/`wp-config`, directory listing — score + fix buttons. | S | NEW | A site with PHP 7.4 + expired cert scores < 50 with listed fixes. |

## 2.8 Backups & restore (panel's own)

| ID | Requirement | Pri | Type | Acceptance |
|---|---|---|---|---|
| FR-BKP-01 | Remote backups: destinations via rclone-compatible config — S3, Wasabi, DO Spaces, Dropbox, Google Drive, Hetzner Storage Box, SFTP, custom rclone. Schedule (daily/weekly, time, timezone-aware), retention (days), include/exclude (default: all sites; exclude cache/tmp/logs), per-site opt-out. | M | PARITY | Configure S3 → nightly backup runs → files appear in bucket. |
| FR-BKP-02 | **One-click restore in UI (BETTER):** list remote snapshots, pick one → restore files and/or DB to the same site or a new site (staging), with pre-restore backup of current state. No CLI needed for ≤ 2 GB; larger via background job. | M | BETTER | Restore a snapshot from UI; site works; current state was backed up first. |
| FR-BKP-03 | Local backups: on-demand site backup (files `.tar.gz` + DB `.sql.gz` + manifest JSON), download, retention, storage path configurable. | M | PARITY | Download a site backup; manifest validates. |
| FR-BKP-04 | Backup verification: scheduled test-restore to a disposable staging site (weekly, optional), report pass/fail. A backup that has never been test-restored is labelled "Unverified". | S | BETTER | Test-restore runs weekly; report shows pass. |
| FR-BKP-05 | Panel self-backup: panel metadata DB + config + NPM export (hosts/certs list) backed up nightly to a remote destination; restore procedure documented and tested (see §8). | M | NEW | Restore panel from backup on a fresh host in < 30 min (drill). |

## 2.9 Users, admin area, API / CLI

| ID | Requirement | Pri | Type | Acceptance |
|---|---|---|---|---|
| FR-USR-01 | Users: add/edit/disable/delete, roles (FR-SEC-06), assign sites, timezone, language, avatar. First-admin creation is a one-time flow — after install, panel is locked until the first Admin exists (bots must not create it). | M | PARITY | Fresh install → `/` redirects to create-admin; second create attempt fails. |
| FR-USR-02 | Admin Area: Users, Vhost Templates, Instance Settings (panel domain, timezone, default PHP/DB engine, backup defaults), Remote Backups, Security, Services, Events. Same IA as CloudPanel (Dashboard / Sites / Admin Area) so CloudPanel users feel at home. | M | PARITY | Navigation matches CloudPanel IA; a CloudPanel user finds each setting without help. |
| FR-USR-03 | **REST API (NEW):** versioned `/api/v1/*`, JWT + API tokens, OpenAPI spec, every UI action available via API. Rate-limited, audited. | M | NEW | Create a site via `curl` with a token; OpenAPI spec validates. |
| FR-USR-04 | **CLI `nxctl` (BETTER):** `nxctl site:create|list|delete`, `db:add|export|import|backup`, `user:add|list|reset:password|disable:mfa`, `proxy:sync`, `backup:*`, `import:cloudpanel`, `panel:enable:basic-auth` — mirroring `clpctl` verbs where sensible, plus the new ones. Every command has `--help` and `--json`. | M | BETTER | `nxctl site:list --json` works; `nxctl db:export` matches `clpctl` semantics. |
| FR-USR-05 | Notifications: email + webhook (Slack/Discord/generic) for SSL expiry, backup failure, cron failure, NPM drift, disk full, login from new IP. Per-user preferences. | S | BETTER | Trigger a backup failure → webhook fires with payload. |
| FR-USR-06 | Dashboard: sites count, SSL expiring (7/30 days), disk/CPU/RAM, recent events, backup status, NPM status, DB engine status — at a glance, with links to fix. | M | PARITY | Dashboard shows a real expiring cert in red with a Renew link. |
| FR-USR-07 | **Site-as-code (NEW, v1.1):** export a site to YAML (`site.yaml`: domain, type, PHP, DB engine, cron, NPM host, env), import YAML to recreate it. GitOps-friendly. | S | NEW | Export YAML → delete site → import YAML → site identical. |

## 2.10 CloudPanel import (headline — detail in §05)

| ID | Requirement | Pri | Type | Acceptance |
|---|---|---|---|---|
| FR-IMP-01 | Import sources: (a) CloudPanel remote-backup `backup.tar` file upload, (b) local backup `.tar.gz` + `.sql.gz`, (c) live CloudPanel server via SSH/SFTP (host, user, key/password, `clpctl`-assisted dump). | M | NEW | All three sources import the same test site correctly. |
| FR-IMP-02 | Import wizard: upload/select → detect (domain, PHP version, DBs, cron, vhost) → mapping screen (PHP version map, DB engine map, domain keep/change, NPM host preview) → dry-run → import → verify → report. | M | NEW | Wizard completes without CLI; dry-run lists every change before it happens. |
| FR-IMP-03 | Import fidelity: files (`htdocs/`), DBs (all `.sql/.sql.gz` found), vhost rules (translated to origin Nginx + NPM host), cron jobs, SSL (re-issue via NPM, or import custom cert if present), FTP/SSH users (recreated as SFTP users), PHP settings. Anything unmapped is listed as a warning, never silently dropped. | M | NEW | Imported WP site loads, logs in, cron runs, SSL valid. |
| FR-IMP-04 | Import safety: dry-run, pre-import snapshot of target (if overwriting), rollback (1-click restore to pre-import state), idempotency (re-running the same import does not duplicate DBs/users). | M | NEW | Run import twice → second run reports "already imported, no duplicates"; rollback restores pre-import site. |
| FR-IMP-05 | Bulk import: import N sites from one CloudPanel server / one backup set, with a queue, per-site status, and a summary report (success / warnings / failures with logs). | S | NEW | Import 5 sites in one batch; report shows 5/5 with timings. |

## 2.11 Out-of-scope (W) — do not build in v1

- W1 Mail server / webmail / mailboxes on the panel host.
- W2 DNS server / DNS zone hosting on the panel host.
- W3 Apache / LiteSpeed origin.
- W4 Billing / invoicing / reseller storefront.
- W5 Kubernetes multi-node orchestration.
- W6 cPanel/WHM import in MVP (v1.1 — see FR-IMP-05 note in §05).
