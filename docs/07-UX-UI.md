# 07 — UX & UI

## 7.1 Information architecture (mirrors CloudPanel, so its users feel at home)

```
Sidebar (left, collapsible)
├── Dashboard
├── Sites
│   └── Site detail → tabs: Overview | Files | Databases | SSL/TLS | PHP Settings
│                     | Vhost | Security | SSH/FTP | Cron Jobs | Logs | Backups | Import*
│                     (* Import is a top-level wizard too — see §7.3)
├── Import CloudPanel  (top-level, prominent in MVP — it is the migration path)
├── Backups (global)
├── ─────────────
├── Admin Area
│   ├── Users
│   ├── Database Engines
│   ├── Edge / NPM (Proxy Hosts, Certificates, Access Lists, Streams)
│   ├── Vhost Templates
│   ├── Remote Backups
│   ├── Security (Firewall, Basic Auth, Bot Blocker)
│   ├── Services
│   ├── Events (Audit Log)
│   └── Settings (Instance, Panel Domain, Notifications)
└── User menu (bottom): Profile, API Tokens, 2FA, Language, Theme (Light/Dark), Logout

Top bar: ⌘K Search | + Add Site | + Import | Notifications (bell) | Health (NPM/DB dots)
```

## 7.2 Key screens (what each must show — wireframe-level, not pixel-level)

### Dashboard
- Cards: Sites (live / total), SSL expiring (7d / 30d, with Renew links), Disk (per host, with top-3 sites by size), CPU/RAM (host), Backup status (last success / failures), NPM status (version, hosts count, drift warnings), DB engines (reachable / unreachable per engine).
- Recent events (last 10, link to Events).
- Quick actions: Add Site, Import CloudPanel, Create Backup, Add Database Engine.

### Sites list
- Table: Domain | Type icon | PHP/Node/Python | DB engine | SSL (expiry) | Status | Disk | Actions (⋯).
- Search (domain/tag), filter (type, status, engine), sort, bulk select (Enable / Disable / Delete / Backup).
- Empty state: "No sites yet — Add your first site or Import from CloudPanel" with both buttons. No blank table.

### Add Site wizard (4 steps, same order as CloudPanel)
1. **Type:** 6 cards (WordPress / PHP / Node.js / Python / Static / Reverse Proxy) + Docker-app / Git (v1.1, shown as "Soon" if not in MVP — do not show a dead button in MVP; hide it).
2. **Domain & root:** domain, aliases (`www` auto-ticked), document root, site user (auto).
3. **Runtime:** PHP version (or Node/Python version + port + entry), DB engine picker (with mode badge: Internal / External / Remote) + "Create database" ticked, Varnish/Redis toggles.
4. **SSL & review:** SSL: None / Let's Encrypt HTTP-01 / DNS-01 (provider) / Custom upload; summary of everything; Create button shows a progress view (job log live).
- Validation is inline (domain syntax, domain already exists, engine unreachable → blocked with a fix link).

### Site detail — Overview tab
- Status, URLs (live + staging if any), SSL expiry + Renew, PHP version + Switch, DB (name, engine, size, Manage → phpMyAdmin), disk usage bar, quick links (Files, Logs, Cron, Backups), recent cron runs, recent events for this site.

### Databases tab
- Table of DBs: Name | Engine (with mode badge) | Size | Users | Actions (Manage / Export / Import / Delete).
- "Add Database" → one-form (name, user, password Generate, privileges).
- Per-DB: Users sub-table (username, host, privileges, Change password, Delete), Import/Export buttons, nightly-dump status.

### Database Engines (Admin)
- Table: Name | Type | Version | Mode (Internal-docker / External-docker / External-remote) | Status dot + latency | Sites using it | Actions (Test, Enable/Disable if internal, Edit, Delete if unused).
- "Add Engine" wizard: Type → Mode → (internal: image/version, or external-docker: container name + network, or remote: host/port/TLS/creds) → Test connection → Save.
- **The toggle Larry asked for is here:** internal engines have a prominent Enable/Disable switch, with the warning text from §3.4.4.

### Edge / NPM (Admin)
- Connection card: NPM base URL, version, status, "Test connection", "Sync now (reconcile)".
- Proxy Hosts table: Domain(s) | Forward (container:port) | SSL | Access list | Enabled | Drift badge | Actions.
- Certificates table: Domain(s) | Provider | Expires | Auto-renew | Actions (Renew, Delete).
- Access Lists table: Name | Users | IP rules | Hosts using it.
- Drift banner (if any): "3 hosts drifted — Review & Reconcile" → diff view (expected vs actual) → Reconcile button.

### Import CloudPanel wizard (see §05 for the flow — this is the UI)
1. **Source:** 3 cards (Upload `backup.tar` / Upload local pair / Live SSH) — with a "What is in a CloudPanel backup?" help link.
2. **Detect:** progress + manifest summary (domain, type, PHP, DBs found, files size/count, warnings: "Cron not in backup").
3. **Mapping:** table (CloudPanel → NexPanel) with pickers for PHP version, DB engine, domain, SSL mode; exclude patterns; search-replace if domain changes.
4. **Dry-run:** list of every action + checks (disk, engine, NPM, PHP image) with ✅/❌; "Import" is disabled until all checks pass or the user explicitly overrides a warning (with a reason logged).
5. **Importing:** progress bar + live log + per-step ✅.
6. **Done:** report (success/warnings/failures), "Open site", "Open WP admin", "Roll back this import", "Import another site".

### Backups
- Global: destinations, schedules, recent runs (status, size, duration, Verify badge).
- Per-site: on-demand backup button, list of snapshots (date, size, destination, Verified/Unverified), Restore (to same site / to new staging site), Download.

## 7.3 UX rules

- **No dead buttons in MVP.** If a feature is v1.1 (Docker-app site, Git deploy, bulk import), hide it in MVP or label it "Soon" with no click. A button that does nothing is a bug.
- **Every wizard shows its cost:** "This will create 2 containers, 1 DB, 1 NPM host, and issue 1 certificate" before the user confirms.
- **Errors are actionable:** "NPM returned 400: Domain not pointing at this server (DNS: example.com → 1.2.3.4, server IP: 5.6.7.8). [Check DNS] [Retry]" — not "Something went wrong".
- **Empty states teach:** each empty table/card has one sentence + one button, not a blank area.
- **Danger is slow:** delete/rollback/destructive DB actions need a typed confirm + show what is kept (trash/rollback window).
- **Progress is honest:** a job that is 40% through a DB import says "Importing database (412 MB / 1.0 GB)" — not a spinning wheel.
- **Theme:** Light default (CloudPanel-like calm), Dark toggle in the user menu. No docs/internal labels leak into the UI (no "FR-xxx", no file paths in user-facing copy unless they are the actual path the user asked for).

## 7.4 Copy tone

- Plain, short, no jargon where a plain word works. "Create a database" not "Provision a datastore".
- Vietnamese in v1.1 — strings are in translation files from day 1 (NFR-UX-06).
