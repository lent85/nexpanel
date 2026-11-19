# NexPanel — AI Agent Guidelines & Architecture Manual

Welcome to **NexPanel** (CloudPanel alternative) — a Docker-native server control panel with an external Nginx Proxy Manager (NPM) reverse proxy, pluggable database engines, and first-class CloudPanel import capabilities.

This document is the **primary instruction manual** for AI Agents (Antigravity, Claude Code, Cursor, Windsurf, Codex, etc.) collaborating on this codebase.

---

## 1. The 3 Non-Negotiable Hard Architectural Rules

Every modification, route, CLI command, and migration MUST strictly adhere to these three rules:

### R1 — The Panel Never Owns Ports 80 / 443
* **Edge Proxy Ownership**: Only the external **Nginx Proxy Manager (NPM 2.16.0)** container owns ports `80` and `443` (and `81` for its admin UI).
* **Communication**: The panel interacts with NPM strictly via its REST API (JWT authenticated) over the shared Docker network (`proxy`).
* **Forward Host Rule**: Forward hosts in proxy host configurations MUST be Docker container/service names (e.g., `site-example-com`), **NEVER** `localhost` or `127.0.0.1`.
* **Resilience**: If NPM is temporarily unreachable, site mutations are queued and automatically reconciled once NPM recovers (`FR-PROXY-07`, `drift-reconciler.ts`).

### R2 — Databases Are Pluggable Engines, Not Baked-In MySQL
* **Pluggable Engine Records**: Every site database is bound to an engine mode:
  1. `internal-docker`: Managed Docker container spawned by NexPanel (e.g., `nexpanel-mysql`).
  2. `external-docker`: Existing Docker container on the host network (`proxy` / `sites`).
  3. `external-remote`: Remote database server (RDS, external host) over IP/FQDN + TLS.
* **Metadata Database Isolation**: NexPanel's own metadata database (PostgreSQL 16) is strictly private (`nexpanel-db`) and **MUST NEVER** be used as a site database.
* **Immutability of External Engines**: External engines can never be stopped, restarted, or deleted by the panel.

### R3 — CloudPanel Import is a First-Class Feature
* **Three Sources Supported**:
  * Source A: `backup.tar` (remote backup containing vhost, htdocs, and nightly MySQL dump).
  * Source B: `local-files.tar.gz` + `local-db.sql.gz` pair.
  * Source C: Live CloudPanel server via SSH.
* **Integrity & Compatibility Guard**: WordPress on PostgreSQL is blocked by default during dry-run simulation.
* **Safety Protocols**: Every import must support dry-run diff simulation, idempotency guards, and 1-click rollback restoring the host to clean state on failure.

---

## 2. Monorepo Structure

```
cloudpanellite/
├── backend/               # Fastify 5 + TypeScript + Zod backend service
│   ├── src/
│   │   ├── api/v1/        # REST endpoints (auth, sites, databases, edge, jobs, imports, users)
│   │   ├── audit/         # Audit logger with automatic credential masking
│   │   ├── auth/          # Argon2id/bcrypt passwords, TOTP 2FA, JWT access/refresh tokens
│   │   ├── backups/       # Site backup/restore, Rclone destinations, panel self-backup
│   │   ├── config/        # Environment config with Zod, brand definition
│   │   ├── cron/          # Site-isolated cron job scheduler
│   │   ├── db/            # Database abstraction: MemoryAdapter (tests) & PgAdapter (Postgres 16)
│   │   ├── db-engines/    # MySQL/MariaDB/PostgreSQL engine registry, provisioner, SSO tokens
│   │   ├── edge/          # NPM API client, proxy mutation queue, drift reconciler
│   │   ├── files/         # File manager service with path traversal defense
│   │   ├── importer/      # CloudPanel tar inspector, dry-run simulator, executor, rollback
│   │   ├── jobs/          # Async background jobs engine with live streaming logs
│   │   ├── rbac/          # Role-Based Access Control (Admin, Site Manager, User, Client)
│   │   ├── security/      # Host UFW manager, Docker published port detection, per-site WAF rules
│   │   ├── sites/         # PHP-FPM pool manager, Nginx vhost templates, WordPress scaffolder
│   │   └── vault/         # AES-256-GCM secret encryption with key rotation & sanitization
│   └── test/              # Comprehensive milestone integration test suite
├── cli/                   # nxctl — Commander-based CLI tool
│   ├── src/
│   │   ├── bin/nxctl.ts   # CLI entrypoint with dual mode: human-readable and structured --json
│   │   └── client.ts      # HTTP API client communicating with backend Fastify server
│   └── test/              # End-to-end CLI command verification
├── frontend/              # React 19 + Vite + Tailwind CSS admin dashboard
├── docker/                # lab-compose.yml defining NPM, Postgres, MySQL, Redis lab stack
├── fixtures/              # Synthetic CloudPanel test fixtures (backup.tar, broken.tar, checksums)
├── docs/                  # 10 Architecture & Functional Requirement specifications (FR-xxx, NFR-xxx)
├── scripts/               # Fixture generator and operational utilities
└── .agents/               # Antigravity AI Agent skills and workspace runbooks
```

---

## 3. Technology Stack & Coding Standards

1. **Pure ECMAScript Modules (ESM)**:
   * Package type is `"type": "module"`.
   * **Mandatory**: All relative TypeScript imports MUST explicitly specify the `.js` extension:
     ```typescript
     // Correct
     import { getDb } from './db/index.js';
     import { VaultService } from './vault/vault.js';
     
     // Incorrect - will fail in Node ESM
     import { getDb } from './db/index';
     ```
2. **Fastify v5 & Zod Validation**:
   * All API routes must validate request parameters, querystrings, and request bodies using Zod schemas.
   * Use `@fastify/sensible` for standard HTTP errors (`reply.badRequest()`, `reply.notFound()`, `reply.forbidden()`).
3. **Dual-Mode Database Layer**:
   * `MemoryAdapter`: Default during tests (`NODE_ENV=test` or `PANEL_DB_USE_MEMORY=true`). Provides ultra-fast, zero-dependency in-memory storage for rapid agent execution.
   * `PgAdapter`: Used in staging/production with live PostgreSQL 16 metadata store.
4. **Secret Management & The Vault (`backend/src/vault/vault.ts`)**:
   * Sensitive values (passwords, private keys, API tokens) must be encrypted using `VaultService.encrypt()`.
   * Format: `vault:enc:v1:<iv>:<authTag>:<ciphertext>` (AES-256-GCM).
   * **Strict Rule**: Never log, audit, or return raw secrets. Always run objects through `VaultService.sanitizeObject()` before logging.
5. **CLI Contracts (`nxctl`)**:
   * Every CLI command must support `--json`.
   * Standard output for `--json` must be clean, single-line or pretty JSON without polluting stderr logs.
   * Non-zero exit code (`1`) on any command failure.

---

## 4. Model Context Protocol (MCP) Tools

The project is configured for continuous AI Agent development with the following MCP servers (defined in `mcp_config.json` and `.mcp.json`):

| MCP Server | Command | Purpose in NexPanel Development |
|---|---|---|
| **`codegraph`** | `codegraph serve --mcp` | **Symbol & Call Graph Intelligence**: Answers symbol locations, multi-hop call hierarchies, blast radius, and verbatim code context in 1 call via `codegraph_explore`. |
| **`postgres`** | `npx @modelcontextprotocol/server-postgres <url>` | **Database Schema Inspector**: Inspects metadata tables, relations, and validates migrations (`001_initial_schema.sql`, `002_security_firewall.sql`). |
| **`docker`** | `npx @modelcontextprotocol/server-docker` | **Container & Network Inspector**: Monitors NPM container, PHP pools, database containers, and Docker networks (`proxy`, `sites`). |
| **`playwright`**| Native `@playwright/mcp` | **Web UI Testing**: E2E browser automation for frontend dashboard and NPM admin portal (port 81). |

> [!TIP]
> **CodeGraph Rule**: Before running grep searches or reading multiple files across directories, use `codegraph_explore` (or shell `codegraph explore "<query>"`) to retrieve exact source definitions and dependency trees in a single shot.

---

## 5. Development & Testing Workflow

Always execute commands from the repository root:

| Task | Command | Notes |
|---|---|---|
| **Run all tests** | `npm test` | Runs backend milestone tests + CLI tests. |
| **Backend tests only** | `npm run test:backend` | Fastify, Vault, RBAC, NPM client, DB provisioner, Importer. |
| **CLI tests only** | `npm run test:cli` | Verifies `nxctl` commands with human and `--json` outputs. |
| **Typecheck codebase** | `npm run typecheck` | Checks TypeScript across all packages with `--noEmit`. |
| **Build all packages** | `npm run build` | Compiles backend and CLI into `dist/`. |
| **Regenerate test fixtures**| `npm run fixtures:generate` | Creates synthetic CloudPanel `backup.tar` and checksums. |
| **CodeGraph sync** | `npm run codegraph:sync` | Updates the CodeGraph semantic index after modifying files. |
| **Start backend dev** | `npm run dev:backend` | Starts Fastify server with hot reload via `tsx watch`. |
| **Start Docker lab** | `npm run lab:up` | Boots NPM 2.16.0, Postgres, MySQL, Redis lab containers. |

### Verification Protocol Before Completing Tasks
1. Run `npm run typecheck` — zero TypeScript errors permitted.
2. Run `npm test` — all 70+ integration and unit tests must pass.
3. If new symbols or routes were added, run `npm run codegraph:sync` to keep the semantic index fresh.

---

## 6. Specification Map

Consult the detailed requirements in `docs/` when designing or extending features:
* `docs/01-OVERVIEW-VISION.md`: CloudPanel parity checklist & core value propositions.
* `docs/02-FUNCTIONAL-REQUIREMENTS.md`: Every functional requirement (`FR-SITE-*`, `FR-DB-*`, `FR-PROXY-*`, `FR-IMP-*`, `FR-SEC-*`).
* `docs/03-ARCHITECTURE.md`: External NPM topology, Docker networking, data flow.
* `docs/04-DATA-MODEL-API.md`: Database schemas, REST endpoints, `nxctl` CLI commands.
* `docs/05-CLOUDPANEL-IMPORT-MIGRATION.md`: CloudPanel backup format, dry-run simulator, rollback spec.
* `docs/06-NON-FUNCTIONAL-SECURITY.md`: Security, lockout policies, rate limits, encryption drills.
* `docs/07-UX-UI.md`: Screen layouts, navigation, wizards, forms, empty states.
* `docs/08-DEPLOYMENT-OPERATIONS.md`: Installation script, container upgrade lifecycle, backup drills.
