# 06 — Non-Functional Requirements & Security

## 6.1 Performance

| ID | Requirement | Target |
|---|---|---|
| NFR-PERF-01 | Panel UI: first paint < 1.5 s, interaction < 200 ms (p95) on a 2 GB VPS, 10 sites. | Measure with Lighthouse / panel timing logs |
| NFR-PERF-02 | Site create (PHP, no WP): < 60 s end-to-end (containers + DB + NPM host). WordPress install: < 5 min. | Job timing logs |
| NFR-PERF-03 | NPM proxy-host create via API: < 10 s (excluding LE issuance, which is Certbot-bound). | Job timing logs |
| NFR-PERF-04 | DB import: 100 MB `.sql.gz` in < 3 min; 1 GB in < 20 min (background job, progress shown). | Job timing logs |
| NFR-PERF-05 | File manager: list 10k files in < 2 s; search in < 2 s. | UI timing |
| NFR-PERF-06 | Origin: PHP site TTFB < 300 ms (warm, Varnish off), < 100 ms (Varnish HIT) on a 2 vCPU / 2 GB host. No performance claims beyond this without a benchmark. | Benchmark script in repo |
| NFR-PERF-07 | Panel must not degrade sites: panel containers capped (web 512 MB, worker 1 GB by default, configurable); a panel backup/queue backlog must not starve PHP-FPM pools. | Docker resource limits in compose |

## 6.2 Reliability & availability

| ID | Requirement | Target |
|---|---|---|
| NFR-REL-01 | Panel uptime: 99.5% monthly (single-host, excluding host maintenance). Sites keep serving if the panel is down (NPM + origins are independent). | Uptime check |
| NFR-REL-02 | NPM down: sites keep serving (Nginx config is on disk in NPM); panel queues proxy changes and drains the queue on recovery (FR-PROXY-07). No site data is lost. | Chaos test: stop NPM 10 min, create a site, start NPM, queue drains |
| NFR-REL-03 | DB engine down: sites on that engine show "DB unreachable" (not a panel crash); other engines' sites unaffected; panel shows per-engine status. | Chaos test: stop one engine |
| NFR-REL-04 | Every mutation is a job with retry (3×, exponential backoff) + compensating actions on failure (§3.6 step 5). No half-created site is left as "live". | Failure-injection tests |
| NFR-REL-05 | Panel self-backup restores on a fresh host in < 30 min (FR-BKP-05 drill, quarterly). | Drill log |
| NFR-REL-06 | Upgrades: panel upgrade is a rolling container replace with a DB migration (forward-only, reversible for 1 version). A failed migration rolls back the containers + DB (backup taken before migration). | Upgrade runbook test |

## 6.3 Scalability

| ID | Requirement |
|---|---|
| NFR-SCAL-01 | v1: 1 host, 100 sites, 200 DBs, 50 users. Must not degrade below NFR-PERF targets at that scale. |
| NFR-SCAL-02 | Data model carries `hostId` from day 1 (§3.8). No v1 schema change may be needed to add a second host in v2. |
| NFR-SCAL-03 | Job queue is bounded (max 5 concurrent site creates, 2 concurrent DB imports by default) so a bulk import cannot OOM the host. Queue depth is visible in the dashboard. |

## 6.4 Security (normative — see also FR-SEC-01–08)

| ID | Requirement |
|---|---|
| NFR-SEC-01 | **Default-deny:** panel port (8443) is not published to the internet by default. The installer asks "Expose panel on the internet?" — default No (SSH tunnel / NPM proxy host with access list only). If the user says Yes, the installer warns and requires 2FA + Basic Auth. |
| NFR-SEC-02 | **First-admin race:** after install, the panel is in "setup" mode until the first Admin is created; setup mode is only reachable from localhost / the installer's IP for the first 15 min, then it locks and requires CLI (`nxctl user:add`) to create the first Admin. This closes CloudPanel's known "bots create the admin before you do" window. |
| NFR-SEC-03 | Passwords: Argon2id, min 12 chars, breach check (HaveIBeenPwned k-anonymity, optional, off by default if no internet). Secrets: AES-256-GCM, key 0600, rotation supported. |
| NFR-SEC-04 | 2FA: TOTP, enforced for Admin by default; recovery codes (10, one-time, hashed). `nxctl user:disable:mfa` exists for lockout recovery (requires host root). |
| NFR-SEC-05 | Sessions: JWT access 15 min + refresh 7 days, rotation on use, revoke-all on password change, list/revoke per session in UI. |
| NFR-SEC-06 | Brute force: 5 failed logins → 15-min lockout per account + per IP; login attempts are audited; alert on login from a new IP/country. |
| NFR-SEC-07 | Site isolation: per-site UID + volume permissions (750, owner = site UID), no site can read another site's files or another site's DB creds. Verified by an automated isolation test in CI (site A container tries to read site B's `wp-config.php` → denied). |
| NFR-SEC-08 | DB network: DB containers have no published host ports by default; remote DBs are reached over TLS where the engine supports it; the panel never opens 3306/5432 to the internet. The firewall UI warns if it detects a published DB port. |
| NFR-SEC-09 | Headers: panel + origins send `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (panel), `Referrer-Policy`, `Permissions-Policy`, HSTS (via NPM, when SSL forced). CSP on the panel UI. |
| NFR-SEC-10 | Dependencies: `npm audit` / `go vet` in CI, no critical vulns in the shipped image; base images pinned by digest in production compose; Dependabot/Renovate enabled. |
| NFR-SEC-11 | Audit log is append-only (no API to edit/delete it); retention 90 days default, exportable; audit covers every mutation + login + secret reveal. |
| NFR-SEC-12 | Backups: rclone crypt (encrypted) is the default for remote destinations; if the user disables encryption, the UI shows a persistent warning. |
| NFR-SEC-13 | No secrets in: logs, audit `before/after`, URLs, Docker labels, error messages returned to the browser, or the `examples/` in this pack (the examples use placeholders only). |
| NFR-SEC-14 | The panel must pass an OWASP ZAP baseline scan (no High findings) before v1.0 ships. The scan report is a release artefact. |

## 6.5 Usability / accessibility

| ID | Requirement |
|---|---|
| NFR-UX-01 | A CloudPanel user can create a WordPress site without reading docs (wizard labels match CloudPanel's: Sites → Add Site → WordPress → domain → PHP → DB → SSL). |
| NFR-UX-02 | Every long operation shows progress + live logs + a Cancel button (where safe) + a "View job" link. No silent spinner > 10 s. |
| NFR-UX-03 | Every destructive action requires a confirm (typed domain/DB name for delete) and states what will be deleted + what is kept (trash/rollback). |
| NFR-UX-04 | Keyboard: ⌘K search, Esc closes overlays, forms are tab-ordered. WCAG 2.1 AA for the panel UI (contrast, focus visible, labels). |
| NFR-UX-05 | Mobile: dashboard + site list + logs are usable on a phone (responsive, no horizontal scroll at 360 px). File-manager editing on mobile is best-effort. |
| NFR-UX-06 | Language: English default, Vietnamese in v1.1 (Larry works in both — the UI strings must be in a translation file from day 1, not hard-coded). |

## 6.6 Operability

| ID | Requirement |
|---|---|
| NFR-OPS-01 | Health endpoints: `GET /health` (liveness), `GET /health/ready` (DB + NPM + queue). Docker HEALTHCHECK uses them. |
| NFR-OPS-02 | Logs: panel logs are JSON, to stdout (Docker logs), with levels; site logs are per-site files + panel UI. No log file grows unbounded (rotation 100 MB × 5). |
| NFR-OPS-03 | Metrics: Prometheus `/metrics` (panel + per-site CPU/RAM/disk if the Docker socket is available — with a warning that Docker-socket access is privileged and must be scoped). Grafana dashboard JSON is a v1.1 deliverable. |
| NFR-OPS-04 | Upgrades: one command (`./upgrade.sh` or `nxctl panel:upgrade`), with a pre-upgrade backup, migration, and rollback. Upgrade notes are shown in the UI before the user confirms. |
| NFR-OPS-05 | Support bundle: 1-click "Download support bundle" (panel version, Docker versions, NPM version, engine statuses, recent logs redacted of secrets, config without secrets) for debugging. |

## 6.7 Compatibility

| ID | Requirement |
|---|---|
| NFR-COMP-01 | Host OS: Ubuntu 22.04 / 24.04, Debian 12 / 13 (x86_64 + ARM64) — same as CloudPanel. Docker Engine 27+ / Compose v2.30+. |
| NFR-COMP-02 | NPM: 2.16.0 (pinned in MVP); the panel must warn (not fail) on a newer NPM minor and must fail fast with a clear message on NPM 2.x API incompatibility (detected via `/api/` version check). |
| NFR-COMP-03 | Browsers: Chrome/Edge/Firefox/Safari current + 1 previous. No IE. |
| NFR-COMP-04 | CloudPanel import: CloudPanel 2.5.x backups (remote `backup.tar` + local `.tar.gz` + live 2.5.x). Older CloudPanel v2 backups are best-effort. |
| NFR-COMP-05 | Data portability: export a site (files + DB + manifest) in an open format (tar.gz + sql.gz + manifest.json) — no proprietary lock-in. A site exported from NexPanel can be imported by the generic importer (and vice versa). |

## 6.8 Legal / licensing (decisions, not code)

- **D-01 (see §9.5):** NexPanel licence — recommended: open-source (AGPLv3 or Apache-2.0) for the panel, with the NPM/MySQL/etc. components under their own licences. CloudPanel CE is free but *not* open-source — NexPanel being open-source is a differentiator, but it is Larry's call.
- The panel must not bundle CloudPanel code, trademarks, or assets. "CloudPanel" is used in this pack only as a compatibility reference (import source), with a disclaimer in the UI: "CloudPanel is a trademark of MGT-COMMERCE GmbH. NexPanel is not affiliated with or endorsed by MGT-COMMERCE."
- Privacy: the panel stores no telemetry by default. If telemetry is added later, it is opt-in, documented, and can be disabled with one toggle.
