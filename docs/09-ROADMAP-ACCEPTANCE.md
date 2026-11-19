# 09 — Roadmap & Acceptance

## 9.1 Phases

### Phase 0 — Decisions + fixtures (1 week, no code)
- Larry answers the 10 decisions in §9.5.
- Build team creates the CloudPanel fixtures (§5.9) and a test NPM + test MySQL/MariaDB/Postgres lab.
- **Exit:** decisions signed off, fixtures exist, lab is up.

### Phase 1 — MVP / v1.0 (6–8 weeks, 1–2 builders)
**Goal:** CloudPanel parity + R1 + R2 + CloudPanel import (single-site). A CloudPanel user can move.

| Workstream | Includes |
|---|---|
| Panel skeleton | Auth, RBAC (3 roles + Client read-only), Dashboard, Admin Area IA, API v1, `nxctl`, audit log, jobs |
| Sites | 6 site types, PHP 7.1–8.5 (Docker images), vhost templates + editor (`nginx -t` gate), per-site PHP settings |
| Edge (R1) | NPM connect, `proxy` network, proxy-host lifecycle via API, SSL via NPM (HTTP-01 + custom), access lists, drift + reconcile, panel's own NPM host |
| Databases (R2) | Engine registry (MySQL/MariaDB/Postgres × internal-docker / external-docker / external-remote), DB+user one-form, phpMyAdmin/Adminer/pgAdmin SSO, import/export, nightly dumps |
| Files / cron / logs | File manager, SFTP users, per-site cron + run history (basic), logs (view/tail/search) |
| Security | 2FA, Basic Auth via NPM, firewall UI, IP/bot block, Cloudflare-only, secrets vault |
| Backups | Remote (rclone) + local, **one-click restore in UI**, panel self-backup |
| Import (R3) | CloudPanel import wizard — sources A + B + C, detect, mapping, dry-run, import, verify, rollback (single site) |
| Ops | Installer, upgrade script, health endpoints, support bundle |

**Explicitly NOT in MVP:** Docker-app sites, Git deploy, staging clone, bulk import, site-as-code YAML, webhooks, granular permissions, Grafana, Vietnamese UI, cPanel importer.

### Phase 2 — v1.1 (4–6 weeks after v1.0)
- Staging clone + push-live, Git deploy, Docker-app sites, bulk CloudPanel import, site-as-code YAML, webhooks (Slack/Discord/generic), granular permissions, Varnish purge hook + WP plugin, backup verification (test-restore), Vietnamese UI, cPanel importer (first version).

### Phase 3 — v2 (design in v1.1, build after)
- Multi-host (second host agent, `hostId` already in the model), Traefik/Caddy edge provider, S3-native backups + restic incremental, WordPress management (core/plugin/theme updates, 1-click WP admin), team workspaces, Grafana dashboards, API v2 if needed.

## 9.2 Test plan (MVP — must pass before v1.0 ships)

| Area | Tests |
|---|---|
| Parity | Parity checklist (CSV in `examples/`) — every `PARITY` row has a test; 100% pass |
| NPM | Connect fresh NPM 2.16; create/delete/disable a host via API; cert HTTP-01 + DNS-01 (Cloudflare) + custom; access list; NPM-down queue + drain; drift detection + reconcile; `localhost` rejected |
| DB | Create a site on each engine/mode combo (internal MySQL, external MySQL Docker, remote MariaDB, Postgres for Node); read-only user cannot write; migrate internal→external; disable internal engine → warning, re-enable → site recovers |
| Import | Fixture 1 (backup.tar) → working WP; fixture 2 (local pair) → working WP; fixture 3 (broken tar) → fail-fast; import twice → no duplicates; rollback → pre-import state; live-SSH import from a real CloudPanel 2.5.4 VM |
| Security | Isolation test (site A cannot read site B); ZAP baseline (no High); 2FA + lockout; secrets not in logs/DB dump; first-admin race (setup locks after 15 min) |
| Backups | Remote backup to S3 (or MinIO in CI) → one-click restore → site works; nightly dump + retention prune; panel self-backup → restore on a fresh host < 30 min |
| Performance | NFR-PERF-01–05 timings on a 2 GB VPS; 100-site list renders < 2 s |
| Upgrade | Upgrade v1.0.0 → v1.0.1 on a host with 5 sites; sites stay up; rollback path tested |

## 9.3 Acceptance criteria (v1.0 — Larry signs off when all are true)

1. [ ] A fresh install (Shape A) completes in < 15 min and the panel is reachable via its NPM host.
2. [ ] Shape C works: install on a host with an *already-running* NPM + external MySQL Docker, without touching either.
3. [ ] All 6 site types can be created from the UI, each with SSL, and each loads over HTTPS.
4. [ ] A site's DB can be on internal MySQL, external MySQL Docker, remote MariaDB, and PostgreSQL (Node) — chosen in the same wizard.
5. [ ] A real CloudPanel `backup.tar` imports to a working WordPress site via the wizard alone (no CLI), with a dry-run shown first.
6. [ ] One-click restore from a remote backup works in the UI.
7. [ ] The parity checklist is 100% green for MVP rows.
8. [ ] ZAP baseline has no High findings; the isolation test passes.
9. [ ] The panel self-backup restores on a fresh host in < 30 min (drill log attached).
10. [ ] No dead buttons, no "Something went wrong" without an actionable next step, no secrets in logs.

## 9.4 Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| NPM API changes / breaks in a new NPM version | Proxy hosts can't be created | Pin NPM 2.16.0 in MVP; version check on connect; `EdgeProvider` adapter isolates the change |
| CloudPanel backup format changes in a new version | Importer mis-detects | Importer is version-tolerant (globs, not fixed paths); detection failures are warnings, not silent drops; fixtures updated per CloudPanel release |
| LE rate limits (50 certs/week/domain) on bulk import | Cert issuance fails | Bulk import issues certs after DNS cutover, staggered; DNS-01 for wildcards covers many subdomains with one cert |
| Docker-socket access for the panel (to create site containers) is privileged | Panel compromise → host compromise | Panel accesses Docker via a scoped socket proxy (e.g. `tecnativa/docker-socket-proxy` with only the needed endpoints) — not the raw `/var/run/docker.sock` — documented in §3.7 |
| PHP version images are large / slow to pull | Site create is slow on first use | Pre-pull the default PHP versions in the installer; show pull progress; cache images |
| WordPress on Postgres confusion | Users pick Postgres for WP and break | Block WP+Postgres by default with a warning + override (§3.4.3) |

## 9.5 Open decisions — Larry, please answer these (one line each is enough)

| # | Decision | Recommendation | Your answer |
|---|---|---|---|
| D-01 | **Licence:** open-source (AGPLv3 / Apache-2.0) or proprietary (like CloudPanel CE — free but closed)? | Apache-2.0 (permissive, agency-friendly) | |
| D-02 | **Name:** NexPanel, or OrbitPanel / PanelForge / HostNest / other? | NexPanel (working name in this pack) | |
| D-03 | **Hosting for the build:** build the panel as a Docker host app (this pack's assumption) — or also as a Muse-hosted demo first? | Docker host app (the real thing); a Muse demo can show the UI only, not the Docker/NPM/DB behaviour | |
| D-04 | **Backend language:** Node.js + TypeScript + Fastify, or Go? | Node.js/TS (matches Larry's other apps, fastest to build) | |
| D-05 | **Default site DB engine on a fresh install:** internal MySQL 8.4 Docker, or MariaDB 12.3? | MySQL 8.4 (CloudPanel default, widest WP compat) | |
| D-06 | **Default PHP on a fresh install:** 8.3 or 8.2? (All 7.1–8.5 available per-site either way) | 8.3 | |
| D-07 | **NPM network name:** `proxy` (most common) or `npm-network`? | `proxy` | |
| D-08 | **Mail/DNS:** confirm out-of-scope in v1 (external Mailgun/SES + Cloudflare DNS, guided setup only)? | Yes — out of scope, guided external setup | |
| D-09 | **Import priority:** CloudPanel import in MVP (this pack) — or defer it to v1.1 and ship sites+DB first? | In MVP — it is the migration reason to switch | |
| D-10 | **Panel domain:** will you give the panel a domain now (e.g. `panel.yourdomain.com`), or access it via IP/SSH tunnel first? | Domain via NPM host (recommended) | |

> Reply with your answers (e.g. "D-01 Apache, D-02 NexPanel, D-03 Docker…") and I'll start the Phase 1 build from this pack without re-asking.

## 9.6 What happens after you approve this pack

1. You answer §9.5.
2. I create the Phase 1 build plan (tasks, files, test fixtures) from this pack.
3. Build starts — first deliverable is the installer + panel skeleton + NPM integration (so you can see the edge working early), then sites, then DBs, then the CloudPanel importer.
4. Each phase ends with the test plan in §9.2 for that phase — no "it works in code only" claims.
