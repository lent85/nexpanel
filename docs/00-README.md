# CloudPanel Alternative — Requirements Pack

**Working name:** NexPanel  
**Version:** 1.0.0 — Requirements (not code)  
**Date:** 19 November 2026  
**Status:** Draft for Larry's review — build does NOT start until §9 decisions are confirmed  
**Baseline researched:** CloudPanel 2.5.4 (1 July 2026) on Ubuntu 24.04 / Debian 12–13, Nginx 1.30, PHP 7.1–8.5, MySQL 8.4 / MariaDB 12.3, Redis 8, Varnish 7.7, Node.js 12–24, Python 3.12; Nginx Proxy Manager 2.16.0 (Sept 2026), `jc21/nginx-proxy-manager:2.16.0`

> This pack is the *what* and the *why*. It does not choose the final stack for you without your sign-off — it gives you the decisions to make in `09-ROADMAP-ACCEPTANCE.md` §9.5, then the build can start from it without re-asking the same questions.

## What Larry asked for

1. **Similar to CloudPanel** — all CloudPanel functions, and better.
2. **External Nginx Proxy Manager (NPM) via Docker, on an external network** — instead of an internal / built-in reverse proxy owned by the panel.
3. **External database engines instead of internal MySQL** — can enable the panel's internal MySQL Docker container *or* use an external MySQL Docker container / remote MySQL / MariaDB / PostgreSQL.
4. **Easy import of backup sites from CloudPanel** — one-click, not manual `tar xf` + `clpctl db:import`.
5. **Requirements documents first, zipped for download.**

## How to read this pack

| File | What it answers |
|---|---|
| `01-OVERVIEW-VISION.md` | Who is it for, what is it, CloudPanel parity map, what "better" means |
| `02-FUNCTIONAL-REQUIREMENTS.md` | Every feature, numbered FR-xxx, MoSCoW priority, acceptance test |
| `03-ARCHITECTURE.md` | How it is built: external NPM, external DBs, Docker topology, networks, data flow |
| `04-DATA-MODEL-API.md` | Entities, fields, REST API, CLI (`nxctl`), events/webhooks |
| `05-CLOUDPANEL-IMPORT-MIGRATION.md` | Exactly what a CloudPanel backup contains, how import maps it, dry-run, rollback |
| `06-NON-FUNCTIONAL-SECURITY.md` | Performance, reliability, security, backup, observability, compliance |
| `07-UX-UI.md` | Screens, navigation, wizards, empty/error states |
| `08-DEPLOYMENT-OPERATIONS.md` | Install, upgrade, backup/restore of the panel itself, runbooks |
| `09-ROADMAP-ACCEPTANCE.md` | Phased plan (MVP → v1.1 → v2), test plan, acceptance criteria, open decisions |
| `10-APPENDICES.md` | Glossary, sources, parity checklist, reference compose files |
| `examples/` | `docker-compose.example.yml`, `.env.example`, `cloudpanel-import-manifest.example.json` — reference only, not production-ready |

## The 3 hard rules of this design

These are the non-negotiable architectural decisions that make this *not* just a CloudPanel clone:

### R1 — The panel never owns ports 80 / 443
Only the external NPM container owns 80/443 (and 81 for its own admin UI). The panel talks to NPM **only via its REST API** (JWT) and via the shared external Docker network. If NPM is down, sites keep serving from cache / last config, but no new route can be created — that failure mode is explicit and tested (see FR-PROXY-07, NFR-REL-03).

### R2 — Databases are pluggable engines, not a baked-in MySQL
Every site database is bound to a **Database Engine** record: `internal-docker | external-docker | external-remote`. The panel's *own* metadata DB (users, sites, jobs) is separate — PostgreSQL by default — and is never a site database. A site can move `internal → external` (and back) with a guided migration; the engine choice is per-site, not per-server, and is never locked at install time the way CloudPanel locks MySQL vs MariaDB at install.

### R3 — CloudPanel import is a first-class feature, not a manual procedure
CloudPanel has **no importer** — restore is manual: download `backup.tar`, `tar xf` as the site user, `rsync` to `htdocs/`, `clpctl db:import`. NexPanel ships an **Import Wizard + `nxctl import:cloudpanel`** that parses `backup.tar` / local `.tar.gz` / live SSH, shows a dry-run diff, maps PHP version / vhost / DB / cron / SSL, and rolls back on failure. See `05-CLOUDPANEL-IMPORT-MIGRATION.md`.

## Naming

- **Working name in this pack:** NexPanel (`nxctl` CLI, `nexpanel` containers).
- Alternatives if you prefer another name: **OrbitPanel, DockPanel, PanelForge, HostNest**. The name is a label only — no code depends on it except the CLI binary name and container prefix, both renameable in one place (`08-DEPLOYMENT-OPERATIONS.md` §8.7).
- **Do NOT ship as "CloudPanel"** — that is MGT-COMMERCE's trademark/product name. This is a compatible alternative, not a fork.

## Conventions used in this pack

- **FR-xxx** = functional requirement, **NFR-xxx** = non-functional, **AC** = acceptance criterion.
- **Must / Should / May** follow RFC 2119.
- **MoSCoW:** M = MVP blocker, S = v1.1, C = v2 / nice-to-have, W = explicitly out of scope.
- **CloudPanel parity:** `PARITY` = CloudPanel has it, we must match it. `BETTER` = CloudPanel lacks it or does it weakly, we must beat it. `NEW` = no CloudPanel equivalent.
- All ports, versions and paths are defaults — configurable via `.env` / Admin → Settings.

## Sources (checked 19 Nov 2026)

- CloudPanel Features / Docs: cloudpanel.io/features, cloudpanel.io/docs/v2/admin-area/backups, cloudpanel.io/docs/v2/cloudpanel-cli/root-user-commands
- CloudPanel 2.5.4 feature survey (Oct 2026): adminsforum.com — sites, PHP 7.1–8.5, Nginx 1.30 HTTP/3, Percona 8.4 / MariaDB, Redis, Varnish, ProFTPD, `clpctl`
- CloudPanel backup/restore: remote backups via rclone (S3, Wasabi, DO Spaces, Dropbox, Google Drive, Hetzner Storage Box, SFTP, custom rclone); local nightly DB dump 03:15, 7-day retention in `/home/<siteuser>/backups/`; `backup.tar` = vhost + whole home except `.ssh`, `logs`, `tmp`
- Nginx Proxy Manager 2.16.0: `jc21/nginx-proxy-manager:2.16.0`, OpenResty + Certbot, REST API (JWT), proxy hosts / redirection / streams / 404 hosts, certificates (Let's Encrypt HTTP-01 + DNS-01, 86–88 DNS providers, custom upload), access lists (basic auth + IP allow/deny, per-path in 2.16.0), TOTP 2FA since 2.13.6, external network `proxy` / `npm-network` with `external: true`
- Full URLs and notes are in `10-APPENDICES.md`.

## What this pack is NOT

- Not a build, not a running app, not a Docker image. No code is delivered in this zip except reference examples.
- Not a promise that every `BETTER` feature lands in MVP — see the phased roadmap in `09-ROADMAP-ACCEPTANCE.md`. MVP is CloudPanel parity + the 3 hard rules + CloudPanel import. The "better" extras are phased so MVP ships fast.
- Not legal advice on licensing. CloudPanel CE is free but not open-source (MGT-COMMERCE licence). NexPanel's licence is an open decision (§9.5, D-01).
