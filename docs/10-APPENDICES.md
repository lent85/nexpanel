# 10 — Appendices

## 10.1 Glossary

| Term | Meaning |
|---|---|
| CloudPanel | MGT-COMMERCE's free server control panel (CE 2.5.4). Nginx + PHP-FPM, MySQL/MariaDB, Redis, Varnish. No mail/DNS/Docker. Trademark of MGT-COMMERCE GmbH. |
| NPM | Nginx Proxy Manager — `jc21/nginx-proxy-manager`, OpenResty + Certbot, web UI on :81, REST API, proxy hosts + LE certs. Version 2.16.0 in this pack. |
| Edge | The public entry point (NPM in v1). Owns ports 80/443, terminates TLS, routes by domain. |
| Origin | The per-site web server behind the edge (origin Nginx + PHP-FPM, or a Node/Python app container). Listens on an internal port only. |
| `proxy` network | The shared external Docker network (`external: true`) that NPM, the panel, and every site origin/app join. Container names on this network are valid `forward_host` values for NPM. |
| Site identity | The isolation unit for a site: UID, volume, PHP-FPM pool / app container, DB namespace. One site cannot read another's files. |
| DB engine | A MySQL / MariaDB / PostgreSQL server the panel can provision DBs on — internal-docker, external-docker, or external-remote. |
| `clpctl` | CloudPanel's CLI (`clpctl db:export`, `db:import`, `db:add`, `user:add`, …). `nxctl` mirrors its verbs where sensible. |
| `nxctl` | NexPanel's CLI. |
| `backup.tar` | A CloudPanel remote-backup file: vhost + whole site home (except `.ssh`, `logs`, `tmp`), including nightly DB dumps. |
| Dry-run | A preview of an import/migration that lists every action and check without changing anything. |
| Reconciliation / drift | The scheduled job that diffs panel-expected NPM hosts vs actual NPM hosts and reports/fixes differences. |
| Vhost | An Nginx server-block config for one site (origin). The panel's vhost editor edits the *origin* vhost; NPM hosts are managed via the NPM API, not by editing NPM's Nginx files. |

## 10.2 CloudPanel parity checklist

The full checklist is in `examples/parity-checklist.csv` — one row per feature, with columns: `id, area, feature, cloudpanel_status, nexpanel_mvp, priority, acceptance_ref`. Use it as the test tracker for §9.2.

Summary counts (MVP): 68 PARITY/BETTER/NEW requirements in `02-FUNCTIONAL-REQUIREMENTS.md` (FR-SITE, FR-PROXY, FR-DB, FR-FILE, FR-PHP, FR-CRON/LOG/SVC, FR-SEC, FR-BKP, FR-USR, FR-IMP). Every M-priority FR is an MVP blocker.

## 10.3 Sources

- CloudPanel Features — https://www.cloudpanel.io/features/
- CloudPanel Remote Backups — https://www.cloudpanel.io/docs/v2/admin-area/backups/
- CloudPanel Root User Commands (`clpctl`) — https://www.cloudpanel.io/docs/v2/cloudpanel-cli/root-user-commands/
- CloudPanel CLI blog — https://www.cloudpanel.io/blog/cloudpanel-cli-interface/
- CloudPanel 2.5.4 feature survey (Oct 2026) — https://adminsforum.com/Thread-guide-cloudpanel-features-the-complete-list-2026
- CloudPanel restore guide — https://adminsforum.com/Thread-guide-how-to-restore-a-site-from-a-cloudpanel-backup-files-and-database
- CloudPanel databases guide — https://adminsforum.com/Thread-guide-cloudpanel-databases-create-a-database-users-and-use-phpmyadmin
- CloudPanel backups/security guide — https://adminsforum.com/Thread-guide-cloudpanel-backups-and-security-remote-backups-firewall-and-basic-auth
- NPM Docker guide (external network) — https://www.vpsshell.com/kb/reverse-proxy-with-nginx-proxy-manager-traefik-or-caddy/
- NPM Docker Compose guide (2.16.0) — https://techloverhd.com/2026/11/self-host-nginx-proxy-manager-docker-guide/
- NPM API client — https://github.com/wleci/nginx-proxy-manager-api/blob/HEAD/README.md
- NPM vs Traefik (2.16.0, API, access lists) — https://techloghub.com/compare/nginx-proxy-manager-vs-traefik
- NPM setup guide (2.16.0, first-run, TOTP) — https://dev.to/deploylark/nginx-proxy-manager-with-docker-proxy-hosts-and-free-ssl-18h3

> Versions change. Re-check the CloudPanel and NPM docs on the day the build starts — especially PHP/Node/Python version lists and NPM's API. This pack's version numbers are the researched baseline (19 Nov 2026), not a guarantee.

## 10.4 Reference files in this pack

| File | Purpose |
|---|---|
| `examples/docker-compose.example.yml` | Reference topology: NPM (external `proxy` net) + panel (web/worker/db) + networks. Placeholders only — not production-ready. |
| `examples/.env.example` | Every env var the compose file + panel need, with placeholder values and comments. |
| `examples/cloudpanel-import-manifest.example.json` | What the importer detects from a `backup.tar` — the manifest the mapping screen is built from. |
| `examples/parity-checklist.csv` | Test tracker for the parity checklist (§10.2). |

## 10.5 How this pack was made

- Researched CloudPanel 2.5.4 (features, stack, backups, restore, `clpctl`, roles, security) and NPM 2.16.0 (Docker external network, REST API, proxy hosts, certs, access lists) from the sources in §10.3 on 19 Nov 2026.
- Larry's three requirements are the architecture: external NPM (R1), external DB engines with an internal-MySQL toggle (R2), CloudPanel backup import (R3). Everything else is CloudPanel parity + the "better" list in §1.6.
- No code was written for this pack. The `examples/` files are reference configuration, not a running system.
