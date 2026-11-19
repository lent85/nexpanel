# 05 — CloudPanel Import & Migration

> This is the headline differentiator. CloudPanel has **no importer** — the documented restore is manual. NexPanel must make it a wizard.

## 5.1 What a CloudPanel backup actually contains (researched)

CloudPanel has **three different backup artefacts** — the importer must handle all three, and must tell the user which one they have.

### A — Remote backup (`backup.tar`) — Admin Area → Backups (rclone)

- **What it is:** one `backup.tar` per site per run, stored on the remote destination (S3 / Wasabi / DO Spaces / Dropbox / Google Drive / Hetzner Storage Box / SFTP / custom rclone).
- **Contents:** the site's **vhost + entire home directory**, **except** `.ssh`, `logs`, `tmp`. That means it includes `htdocs/<domain>/` (all site files) **and** the nightly DB dumps in `~/backups/` (see C below) — so the DB is inside the tar if nightly dumps were running.
- **What it does NOT contain:** the live DB itself (only the last nightly dump), the panel's user/role assignments, the Nginx vhost *as a separate file* is inside the home (the vhost file is stored under the site user's home in CloudPanel's layout — the importer must locate it, not assume a path), SSL private keys (LE certs are re-issued, not imported — see §5.4), cron definitions (they live in the panel DB / `/etc/cron.d/clp`, not in the home — the importer must ask / detect via live-SSH mode, §5.2C).
- **Restore in CloudPanel (manual):** download `backup.tar` → upload via SFTP to `~/tmp` → `tar xf backup.tar` as the site user → `rsync -a --delete ~/tmp/<path>/htdocs/<domain>/ ~/htdocs/<domain>/` → `clpctl db:import --databaseName=<db> --file=<path>/<db>.sql.gz`.

### B — Local site backup (`.tar.gz` in `~/backups/`)

- Created from the site's Backup tab / file manager. Compressed archive of `htdocs/` (site files). DB is a separate export (`.sql` / `.sql.gz` from the Databases tab or `clpctl db:export`).
- The importer accepts a pair: `site-files.tar.gz` + one or more `*.sql.gz`.

### C — Nightly DB dumps

- Every DB dumped nightly at **03:15** (a line in `/etc/cron.d/clp`), gzip, **7-day retention**, in `/home/<siteuser>/backups/` (e.g. `mydb-2026-11-18.sql.gz` — exact naming varies by version; the importer must glob `*.sql.gz` in `backups/` and not assume a fixed name).
- These dumps are the DB source when importing from a remote `backup.tar` (they are inside it).

### D — Live CloudPanel server (SSH/SFTP + `clpctl`)

- The most faithful source: the importer SSHs in as root (or a sudo user), runs `clpctl db:export` per DB, `tar`s `htdocs/`, reads the vhost + PHP version + cron from the live system, and streams the artefacts to NexPanel. No manual download/upload by the user.
- Requires: SSH host, user, key or password, and the CloudPanel server to be reachable from the NexPanel host. The importer must not store the SSH password — use a key, or a one-time password that is discarded after the import.

## 5.2 Import sources (FR-IMP-01)

| Source | Input | When to use it |
|---|---|---|
| **A — Upload `backup.tar`** | File upload (chunked, up to 20 GB) or a URL / S3 path the panel can fetch | User already has a remote-backup file |
| **B — Upload local pair** | `*.tar.gz` (files) + `*.sql.gz` (one per DB) | User has a manual local backup |
| **C — Live SSH** | Host, port, user, SSH key (paste / upload), site domain (or "all sites") | Best fidelity — gets cron + vhost + PHP version live; recommended |

## 5.3 Detection — what the importer parses

On upload / after SSH dump, the importer extracts to a temp dir and builds a **manifest** (see `examples/cloudpanel-import-manifest.example.json`):

| Detected item | How | If not found |
|---|---|---|
| Domain(s) | From `htdocs/<domain>/` dir name(s) + vhost `server_name` | Ask the user to type the domain |
| Site type | `wp-config.php` → WordPress; `composer.json` + `artisan` → Laravel (PHP); `package.json` → Node; `requirements.txt` / `manage.py` → Python; else Static/PHP | Default to PHP, let user override |
| PHP version | Vhost `fastcgi_pass` pool name (e.g. `php8.3-fpm`) or `.php-version` / `composer.json` `php` constraint | Default to server default PHP (8.3), user can change in mapping |
| Document root | Vhost `root` directive | Default `htdocs/<domain>` |
| Databases | `*.sql.gz` in `backups/` + DB name/user/host parsed from `wp-config.php` / `.env` / `config.php` | Ask user; DB can be created empty and imported later |
| DB users + privileges | `wp-config.php` (`DB_USER`) gives one user; full user list needs live-SSH (`SHOW GRANTS` / CloudPanel DB) — otherwise recreate one RW user per DB | Create one RW user per DB, note in report |
| Cron jobs | Live-SSH only: `crontab -u <siteuser> -l` + `/etc/cron.d/clp` lines for that user; from a tar, cron is **not** present — wizard warns "Cron not in backup — re-add manually or use Live SSH" | Warn, don't silently drop |
| Vhost rules | Vhost file: `root`, `index`, `location` blocks, `client_max_body_size`, security headers, redirects | Translate to NexPanel vhost template + custom snippet (see §5.4) |
| SSL | Cert files are not in the backup; LE certs are re-issued via NPM after DNS points at the new server. Custom certs: if `.crt`/`.key` are found in the home, offer to import them | Re-issue by default |
| SSH/FTP users | Live-SSH: `/etc/passwd` entries for the site user + `~/.ssh/authorized_keys`; from a tar, only the site user itself | Recreate as SFTP users; keys are re-added from the manifest if present |
| File size / count | `du` / tar listing | Shown in dry-run so the user sees "2.1 GB, 14,203 files" before committing |

**Detection must be read-only and non-destructive.** It never writes to the live site or the target until the user confirms the mapping + dry-run.

## 5.4 Mapping — the screen the user sees before import

| CloudPanel thing | NexPanel thing | User choice in mapping |
|---|---|---|
| Domain `example.com` | Site domain | Keep, or change (with 301 old → new option) |
| Site user `examplecom` | Site identity (UID + volume) | Auto (panel assigns) — shown, not editable in MVP |
| PHP 8.2 (from vhost) | PHP version | Map to 8.2 (if image available) or pick another (8.3 default) — warn if the app requires the old version |
| Vhost template (WordPress) | Origin Nginx vhost template + custom snippet | Pick template; custom `location` blocks are carried over as a snippet, shown in a diff |
| MySQL DB `wp_db` (MySQL 8.4) | DB on engine X | Pick engine: internal MySQL / external MySQL / MariaDB / PostgreSQL (Postgres warns for WP) |
| DB user `wp_user` | DB user | Keep name/password (password is re-generated unless the user pastes the old one — the old password is **not** in the backup, so the wizard must say so and offer to update `wp-config.php` automatically) |
| Cron `*/15 * * * * wp-cron.php` | Cron job | Keep / edit / skip |
| SSL (LE) | NPM cert | Re-issue via NPM (HTTP-01 after DNS cutover, or DNS-01 now) / import custom cert if found |
| Files `htdocs/example.com/` | Volume `htdocs/` | Keep path; exclude patterns editable (`cache/`, `tmp/`, `*.log`) |
| Remote-backup schedule | NexPanel backup schedule | Copy schedule (daily 02:00, retention 7 days) or set a new one |

**Search-replace:** if the domain changes (or the site moves from `example.com` to `staging.example.com`), the importer offers a DB search-replace (`example.com` → new domain, serialised-safe for WordPress — use WP-CLI `search-replace`, not raw SQL `REPLACE`, so serialised options don't break).

## 5.5 Import run — steps, safety, rollback

```
1. Upload / fetch source → verify checksum (if provided) → extract to temp (disk-space check first: need 2× tar size free)
2. Detect → manifest.json → show mapping screen
3. User confirms mapping → Dry-run:
   - lists every action (create site, create DB X on engine Y, import N rows, create NPM host, issue cert, create cron)
   - checks: disk space, engine reachable, PHP image available, domain not already a site, NPM reachable
   - dry-run creates NOTHING (except the temp extract, which is cleaned up)
4. User clicks Import → job runs (background, progress bar, live log):
   a. Create site (origin containers + volume) — status: importing
   b. Extract files → rsync to htdocs/ (preserving permissions, site UID)
   c. Create DB(s) + user(s) on the mapped engine(s)
   d. Import SQL (gunzip → mysql/psql, chunked, with progress; large DBs run as a job, not a browser request)
   e. Write wp-config.php / .env with the NEW DB creds (old creds are in the backup's wp-config — the importer rewrites them and keeps a `.bak`)
   f. Write origin vhost → nginx -t → reload
   g. Create NPM proxy host → request cert (if DNS already points here) or create host without SSL and queue cert for after DNS cutover
   h. Create cron jobs, SFTP users
   i. Verify: HTTP 200 on the domain (via Host header if DNS hasn't cut over yet — see §5.6), DB row counts match the dump's counts, WP admin login page loads
5. Report: success / warnings (e.g. "Cron not in backup", "PHP 7.4 mapped to 8.3 — test plugins") / failures with logs
6. Rollback: 1-click "Roll back this import" restores the pre-import snapshot (if overwriting an existing site) or deletes the imported site + DBs + NPM host (if new). Rollback is available for 7 days.
```

**Idempotency:** re-running the same import (same source checksum + same target domain) detects the existing imported site and asks "Re-import (overwrite) / Skip / Import as staging" — it never creates a duplicate DB or user.

## 5.6 Zero-downtime cutover (recommended flow)

1. Import to NexPanel with DNS **still** pointing at CloudPanel (site is reachable via a temporary domain `example-com.staging.nexpanel.local` or via `curl -H "Host: example.com"`).
2. Verify the imported site on the temp domain (click through, log into WP admin, test checkout/forms).
3. When happy, change DNS to the NexPanel/NPM IP (lower TTL to 300 s an hour before).
4. Panel issues the LE cert via NPM (HTTP-01 now works) and flips the proxy host to the real domain.
5. Keep the CloudPanel site for 7 days as a fallback; then decommission.

The wizard must explain this flow on the mapping screen — it is the difference between a scary migration and a calm one.

## 5.7 Bulk import

- From one CloudPanel server (live-SSH) or one backup set (multiple `backup.tar` files): queue N sites, import sequentially (or 2 in parallel, configurable), per-site status, summary report with timings + warnings. A failure on site 3 does not abort sites 4–5 — it logs and continues, and the summary lists the failure with a Retry button.
- Bulk import is **S** (v1.1) if single-site import is solid in MVP — do not let bulk delay MVP.

## 5.8 What the importer explicitly does NOT do (and says so)

- Does **not** import mailboxes / DNS zones — CloudPanel has none, so there is nothing to import; the report says "No mail/DNS in CloudPanel — configure external mail/DNS separately" with links.
- Does **not** import the CloudPanel panel users/roles — the wizard asks who should own the imported site in NexPanel.
- Does **not** copy SSL private keys from CloudPanel (they are not in the backup) — it re-issues.
- Does **not** guarantee a PHP 7.1 app runs on PHP 8.3 — it maps the version, warns, and lets the user pick the old version if the image exists.
- Does **not** import a backup that fails checksum / is truncated — it fails fast with "Backup appears truncated (expected X bytes, got Y)" instead of importing half a site.

## 5.9 Test fixtures (build must create these)

The build must create and keep these fixtures in the repo (not in this zip — they are test data, not requirements):

1. `fixtures/cloudpanel/backup.tar` — a synthetic CloudPanel remote backup: WP site, `htdocs/example.com/` with `wp-config.php`, `backups/wp_db-2026-11-18.sql.gz`, vhost file, 10 MB.
2. `fixtures/cloudpanel/local.tar.gz + db.sql.gz` — the local-pair variant.
3. `fixtures/cloudpanel/broken.tar` — truncated tar, for the fail-fast test.
4. A live CloudPanel 2.5.4 VM (or a Docker mock that serves the same `clpctl` + file layout) for the live-SSH path — at minimum, a mocked SSH server in CI.

Acceptance: importing fixture 1 via the wizard yields a working WP site (FR-IMP-03); fixture 3 fails fast with a clear error; fixture 1 imported twice does not duplicate (FR-IMP-04).
