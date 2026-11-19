# 01 — Overview & Vision

## 1.1 One-sentence product

**NexPanel is a Docker-native, API-first server control panel that manages WordPress / PHP / Node.js / Python / static / reverse-proxy sites — with the public edge owned by an external Nginx Proxy Manager container and site databases on any MySQL / MariaDB / PostgreSQL engine, internal or external — and imports CloudPanel sites in one click.**

## 1.2 Who it is for

| Persona | Needs | Pain with CloudPanel today |
|---|---|---|
| **Solo dev / freelancer (primary)** — Larry's profile: runs 5–30 sites on 1–3 VPS, WordPress + PHP + Node | Create a site in < 5 min, free SSL, per-site PHP, DB in one form, restore a backup without SSH gymnastics | No Docker, DB engine locked at install, no importer, no staging/Git, manual restore via `tar` + `clpctl` |
| **Small agency** — 2–10 people, client sites | Scoped access per client/site, staging → production, audit log, one-click clone | CloudPanel roles are only Admin / Site Manager / User; no per-site resource limits, no staging, no Git deploy |
| **Self-hoster / homelab** — already runs NPM + Docker | Panel must *not* fight the existing NPM + Docker network; must join it | CloudPanel needs a fresh VM, forbids existing Nginx/MySQL, no Docker manager at all |
| **Migrator** — moving off CloudPanel / cPanel | Import existing sites + DBs + cron + SSL with a dry-run first, zero-downtime cutover | CloudPanel → anywhere is manual file + SQL copy; no converter exists |

**Explicitly NOT for (v1):** shared/reseller hosting with per-customer billing, mailboxes + DNS hosting on the same box (same deliberate exclusion as CloudPanel — use external mail/DNS), Windows servers, LXC/OpenVZ (VM or bare metal + Docker only, like CloudPanel's VM-only rule).

## 1.3 Goals (measurable)

| # | Goal | Measure (acceptance) |
|---|---|---|
| G1 | CloudPanel parity for daily site work | Parity checklist in `10-APPENDICES.md` — 100% of `PARITY` items pass in MVP |
| G2 | External NPM is the only edge | Zero panel-owned listeners on 80/443; `ss -tlnp` shows only NPM on 80/443; panel creates/deletes a proxy host via NPM API in < 10 s |
| G3 | DB freedom | A site can be created on (a) internal MySQL Docker, (b) external MySQL Docker, (c) remote MySQL/MariaDB, (d) PostgreSQL — all from the same UI, no reinstall |
| G4 | CloudPanel import is easy | Import a real CloudPanel `backup.tar` + DB dump to a working site in < 15 min guided, with dry-run diff and 1-click rollback |
| G5 | Safer than CloudPanel by default | Panel port not world-open by default, 2FA enforced for Admin, secrets in vault not env-plaintext, audit log for every mutation |
| G6 | Fast to recover | Panel itself restores from backup in < 30 min; site restore from panel backup in < 10 min for a ≤ 2 GB site |

## 1.4 Non-goals (v1)

- Built-in mail server (Postfix/Dovecot/Roundcube), DNS server (BIND/PowerDNS) — **out, by design**, like CloudPanel. Provide guided external setup (Mailgun/SES/Resend + Cloudflare DNS) instead.
- Apache / LiteSpeed / OpenLiteSpeed as origin — Nginx-origin only in v1 (Node/Python/static may use their own origin, but the panel's PHP path is Nginx + PHP-FPM).
- Reseller billing, invoicing, WHMCS-style accounts.
- Kubernetes orchestration — Docker Compose / single-host Docker in v1; multi-host is a v2 design constraint, not a v1 feature.
- WordPress multisite auto-management beyond a normal WP site (install + clone + staging covers most).

## 1.5 CloudPanel parity map (summary)

CloudPanel 2.5.4 baseline — what we must match, and where we beat it. Full traceability is in `02-FUNCTIONAL-REQUIREMENTS.md` and the checklist CSV in `examples/`.

| CloudPanel area | CloudPanel (2026) | NexPanel MVP | NexPanel "better" |
|---|---|---|---|
| Site types | WordPress, PHP, Node.js, Python, static, reverse proxy — each own Linux user | Same 6, each own **site identity** (Linux user in VM mode, Docker user/UID + volume in Docker mode) | + Docker-app site (any compose service), + Git-deploy site, + staging clone |
| PHP | 7.1–8.5 side-by-side, per-site switch | Same range, per-site switch, per-site `php.ini` | PHP version is a Docker image tag — add a new PHP without reinstalling the host; per-site extensions picker |
| Web server | Nginx 1.30 (HTTP/3), 30+ vhost templates, vhost editor | Origin Nginx per PHP/static site + **external NPM as edge** | Vhost templates versioned in Git, diff/preview before apply, `nginx -t` gate on every change |
| SSL | Let's Encrypt per site, auto-renew, import custom cert | Via NPM: LE HTTP-01 + DNS-01, wildcard, custom upload, auto-renew | Central cert inventory, expiry alerts 30/14/7/1 days, DNS-01 for wildcard without port 80 |
| Databases | MySQL 8.4 *or* MariaDB at install (locked), remote DB add, phpMyAdmin SSO | MySQL / MariaDB / PostgreSQL, internal-docker *or* external-docker *or* remote, per-site choice | Engine switch/migration wizard, per-DB backup schedule, Adminer + phpMyAdmin + pgAdmin |
| Caching | Varnish 7.7 per site, Redis 8 object cache | Same, as optional per-site services | Cache purge from panel + WP plugin hook, Redis per-site isolation + memory cap |
| Files | File manager, SFTP/SSH/FTP users per site | Same, web file manager + SFTP + SSH keys | In-browser code editor with syntax highlight, drag-drop upload, trash/restore |
| Cron | Per-site cron, templates, run as site user | Same, per-site cron (containerised cron) | Cron run history + logs per run, failure alerts, disable-without-delete |
| Logs | Nginx + PHP access/error logs in panel | Same, plus NPM access logs per host | Live tail, search/filter, download, retention policy |
| Security | UFW firewall, IP/bot block, Basic Auth, Cloudflare-only, 2FA, site isolation | Same concepts, Docker-aware firewall rules + NPM access lists | Fail2ban + rate-limit presets, WAF rules via NPM custom config, security score per site |
| Users/roles | Admin / Site Manager / User (assigned sites) | Same 3 + **Client** (read-only + own sites) | Granular permissions (e.g. "can deploy but not delete DB"), API tokens per user |
| Backups | Nightly DB dump 03:15, 7-day local; remote via rclone (S3/Wasabi/DO/Dropbox/GDrive/Hetzner/SFTP/custom) | Same + panel-level backup | **One-click restore in UI** (CloudPanel restore is manual CLI), incremental + verify (test-restore) |
| CLI | `clpctl` (db, site, user, cloudflare, basic-auth…) | `nxctl` — superset, same verbs where sensible | `nxctl` is API-first: every UI action has a CLI equivalent; import/export as code |
| Services | Services page, events, instance settings | Same + Docker service health | Per-container CPU/RAM/disk graphs, restart policies visible |
| **No Docker** | No Docker manager, VM-only, fresh server required | **Docker-native from day 1** | — |
| **No importer** | No CloudPanel/cPanel importer | **CloudPanel importer** | + cPanel importer in v1.1, + generic tar+SQL importer |

## 1.6 What "better" means — the differentiator list (prioritised)

1. **Pluggable edge (R1).** NPM external, not built-in. Swap NPM for Traefik/Caddy later without touching sites (adapter interface).
2. **Pluggable databases (R2).** No install-time lock-in.
3. **Import, don't re-create (R3).** CloudPanel import is the headline migration feature.
4. **API-first + CLI-first.** Every panel action is a REST call; `nxctl` wraps it. Automation, Terraform-style "site as code" (YAML) in v1.1.
5. **Staging & Git.** One-click staging clone (files + DB search-replace), push staging → live, Git deploy (webhook / pull on push), WP core/plugin/theme update screen.
6. **Docker-app sites.** Run any Docker Compose app as a "site" — the panel gives it a domain via NPM, env vars, volumes, logs, restart.
7. **Safety by default.** Panel behind NPM with access list + 2FA, no `8443` world-open default, secrets encrypted at rest, audit log, 1-click rollback for site changes.
8. **Observability.** Per-site metrics (CPU/RAM/disk/bandwidth), uptime checks, SSL expiry, backup success — in the dashboard, not just logs.
9. **Modern UX.** Same calm CloudPanel-style IA (Dashboard / Sites / Admin Area) but with search (⌘K), bulk actions, dark/light, mobile-usable.

## 1.7 Scope boundaries — the edge vs the origin

This is the most-misunderstood part. Read it before arguing about Nginx:

```
Internet ── :80/:443 ──► [ NPM container — external, jc21/nginx-proxy-manager ]
                              │  shared external network: `proxy` (external: true)
                              ├─► origin-nginx: site-a (PHP-FPM)   :8080 internal only
                              ├─► node-app: site-b                 :3000 internal only
                              ├─► python-app: site-c               :8000 internal only
                              ├─► static-nginx: site-d             :8080 internal only
                              └─► panel itself: nexpanel            :8443 internal only (via NPM proxy host + access list)
```

- **NPM does:** SNI routing, TLS termination, Let's Encrypt, HTTP→HTTPS, HSTS, access lists, custom locations, redirects, streams, 404 hosts.
- **Origin Nginx does:** per-site PHP-FPM fastcgi, static files, vhost rules (WordPress permalinks, security headers that are origin-specific, `client_max_body_size`).
- **Panel does:** create/delete the origin, create/delete the NPM proxy host + cert via API, write the origin vhost, reload origin Nginx (`nginx -t` first), never touch NPM's on-disk config directly.
- **If NPM is replaced later:** only the edge adapter changes. Sites, origins and DBs do not move.

## 1.8 Deployment shapes (v1 must support all three)

| Shape | NPM | Site DB | Panel metadata DB | Who uses it |
|---|---|---|---|---|
| **A — All-in-one Docker host (default)** | External NPM Docker on same host, shared `proxy` net | Internal MySQL Docker (panel-managed) *or* external MySQL Docker on same host | Internal PostgreSQL Docker | Solo dev, first install |
| **B — Split DB host** | External NPM Docker | Remote MySQL/MariaDB/PostgreSQL (RDS / separate VPS / external Docker on another host) | Internal PostgreSQL Docker (or remote) | Agency, existing DB |
| **C — Existing NPM, bring your own** | User's *already-running* NPM — panel only gets API credentials + joins its network | Any of the above | Any of the above | Self-hoster migrating to NexPanel |

Shape C is the proof of R1/R2: the panel must install cleanly when NPM and the DB already exist and the panel owns neither.

## 1.9 Success criteria for this requirements pack

Larry can (a) read `01` + `02` + `05` and know exactly what will be built, (b) answer the 10 open decisions in `09-ROADMAP-ACCEPTANCE.md` §9.5 in one pass, (c) hand this zip to a developer / builder and get a build that matches it without re-interpreting the CloudPanel / NPM / DB requirements.
