# 08 — Deployment & Operations

## 8.1 System requirements (v1)

| Item | Minimum | Recommended |
|---|---|---|
| Host | 1 vCPU, 2 GB RAM, 10 GB disk (same as CloudPanel) | 2 vCPU, 4 GB RAM, 40 GB SSD for 10+ sites |
| OS | Ubuntu 22.04 / 24.04, Debian 12 / 13, x86_64 or ARM64 | Ubuntu 24.04 LTS |
| Docker | Engine 27+, Compose v2.30+ | Latest stable |
| Network | Ports 80/443 open (for NPM), 22 for SSH; panel 8443 **not** open by default | Panel via NPM host + access list |
| DNS | A domain pointing at the server for the panel + each site (for LE HTTP-01) | Wildcard DNS + DNS-01 for staging |
| Existing NPM/DB | Optional — Shape C (§1.8): bring your own NPM and/or DB | — |

**Fresh host is recommended but not required** — unlike CloudPanel (fresh server, no existing Nginx/MySQL), NexPanel must install on a host that already runs NPM and/or a MySQL Docker container, as long as ports 80/443 are owned by NPM and no host Nginx/MySQL is bound to the panel's ports. The installer checks and reports conflicts instead of failing silently.

## 8.2 Install (target: < 15 min, one command + wizard)

```
# 1. On the host:
curl -fsSL https://get.nexpanel.example/install.sh | bash
# — or, if you prefer to inspect first:
#   curl -fsSL https://get.nexpanel.example/install.sh -o install.sh && less install.sh && bash install.sh

# 2. The installer:
#   - checks Docker, OS, RAM, ports 80/443 (warns if something else owns them)
#   - asks: NPM — (a) install a new NPM container, or (b) connect to an existing NPM (URL + admin creds)
#   - asks: panel DB — internal PostgreSQL Docker (default) or remote
#   - asks: default site DB engine — internal MySQL 8.4 Docker (default) or external/remote (or "none — I'll add one later")
#   - creates the external network `proxy` (or joins the existing one)
#   - generates the vault key, writes .env (0600), starts the stack
#   - prints the panel URL (via NPM host if created, else https://<ip>:8443 via SSH tunnel) + the one-time setup link

# 3. First-run wizard in the browser:
#   - create the first Admin (setup mode — see NFR-SEC-02)
#   - panel domain (creates the NPM proxy host for the panel)
#   - default PHP / DB engine / backup destination (optional — can be skipped)
#   - "Import from CloudPanel?" — offers the wizard immediately
```

**Installer rules:** the install script is < 500 lines, shell-checked, idempotent (re-running it upgrades, not duplicates), and never stores a password in shell history (reads from a prompt / env file). All secrets it generates are printed once and written to `.env` (0600).

## 8.3 Reference compose (summary — full file in `examples/docker-compose.example.yml`)

- `proxy` network is `external: true` — created once, shared by NPM + panel + sites.
- NPM: `jc21/nginx-proxy-manager:2.16.0`, `80:80`, `443:443`, `127.0.0.1:81:81`, volumes `./data/npm/data:/data`, `./data/npm/letsencrypt:/etc/letsencrypt`, network `proxy`.
- Panel: `nexpanel-web`, `nexpanel-worker`, `nexpanel-db` (Postgres 16), all on `panel` + `proxy` (web/worker only for NPM API + site networks as needed).
- Site containers are created dynamically by the panel (not in the static compose file) — the panel is the orchestrator for sites.
- **Never** put a site DB password or NPM password in the compose file — use `--env-file .env` (0600) and the vault.

## 8.4 Upgrade

```
./upgrade.sh            # or: nxctl panel:upgrade
# 1. Takes a panel self-backup (DB + config + NPM host list)
# 2. Pulls new images (pinned versions in the release notes)
# 3. Runs DB migrations (forward-only; backup first)
# 4. Rolling-restarts web → worker → scheduler
# 5. Verifies /health/ready; on failure, rolls back containers + restores the pre-upgrade DB backup
# 6. Shows the changelog in the UI; sites are not restarted by a panel upgrade (unless the release notes say so)
```

## 8.5 Backup & restore of the panel itself

| What | How | Restore |
|---|---|---|
| Panel metadata DB (Postgres) | Nightly `pg_dump` to the configured remote destination + local `backups/` | `nxctl panel:restore --file <dump>` on a fresh host, then start the stack |
| Panel config + vault key | In the same backup set (vault key is backed up **encrypted with a user passphrase** — losing the passphrase means losing the secrets; the installer says this in plain language) | Restore the config, re-enter the passphrase |
| NPM state | NPM's `/data` volume is backed up as part of the panel self-backup (hosts, certs, access lists) — or the panel can re-create all hosts from its own `ProxyHost` table via reconciliation (preferred: re-create, don't restore NPM's SQLite blindly) | Re-run `proxy:sync --reconcile` after a fresh NPM install |
| Site files + DBs | Per-site backups (§2.8) — not part of the panel self-backup | Per-site restore (§2.8) |

**Drill (quarterly, FR-BKP-05):** on a staging host, restore the panel from the latest self-backup, run `proxy:sync`, verify 3 sites load. Log the drill (duration, issues) in the Admin → Backups page.

## 8.6 Monitoring & alerting (v1)

- **In-panel:** Dashboard health dots (NPM, each DB engine, disk, queue depth), per-site status, SSL-expiry list, backup-run list.
- **Notifications (FR-USR-05, v1.1 for webhooks; email in MVP):** SSL expiring < 14 days, backup failed, cron failed (3×), NPM drift, disk > 85%, panel upgrade available.
- **External (optional):** Uptime Kuma / Healthchecks as a Docker-app site (FR-SITE-08) — the panel can host its own monitor as a site, which is a nice dogfood.

## 8.7 Renaming / forking

The name `NexPanel`, CLI `nxctl`, and container prefix `nexpanel-` are defined in one place (`config/brand.json` in the build). Renaming to OrbitPanel / PanelForge / etc. is a one-file change + a find-replace in docs. Do not hard-code the brand in code paths.

## 8.8 Runbooks (the build must ship these as docs, not just in this pack)

| Runbook | Trigger |
|---|---|
| NPM is down | Panel banner + queue; `docker logs npm`, `docker restart npm`, queue drains on recovery |
| A site is 502 | Check: origin container running? On `proxy` net? NPM host forward_host = container name? `docker logs site-<slug>-web` |
| DB engine unreachable | Check engine status in Admin → Engines; test connection; if internal-docker, `docker logs <engine>`; if external, check the external host |
| SSL won't issue | Check DNS → server IP, port 80 open, NPM logs (Certbot), rate limits (LE 50/week/domain) |
| Disk full | Dashboard → top sites by disk; prune backups/logs; extend volume |
| Panel locked out (2FA lost) | Host root: `nxctl user:disable:mfa --username <admin>` |
| Import failed halfway | Import report → logs → Roll back → fix the mapped issue (usually PHP version or DB engine) → re-import |
| Panel upgrade failed | `upgrade.sh` rolls back automatically; if manual, restore the pre-upgrade backup (§8.5) |
