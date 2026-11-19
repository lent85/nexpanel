---
name: nexpanel-dev
description: Development, testing, and debugging workflows for NexPanel backend, CLI, and Docker lab. Use when building new features, adding API endpoints, creating CLI commands, running integration tests, or checking R1/R2/R3 rule compliance.
---

# NexPanel Development & Verification Skill

Use this skill to guide development, debugging, and verification tasks in the NexPanel repository.

## 1. Quick Verification Commands

From the workspace root:

```bash
# 1. Typecheck the entire project
npm run typecheck

# 2. Run all backend and CLI milestone integration tests
npm test

# 3. Run only backend tests (concurrency=1 mandatory)
npm run test:backend

# 4. Run only CLI (nxctl) tests
npm run test:cli

# 5. Re-generate synthetic test fixtures
npm run fixtures:generate

# 6. Synchronize CodeGraph index
npm run codegraph:sync
```

## 2. Hard Architectural Rules Checklist

When adding or modifying code, always verify:

### Rule R1: Edge NPM Proxy
* Does any new site or proxy creation set `forward_host` to a Docker service name?
* Reject `localhost`, `127.0.0.1`, `::1` with a clear explanation (`FR-PROXY-01`).
* Is NPM downtime handled with `proxy_queue` and reconciled with `drift-reconciler.ts`?

### Rule R2: Database Engines
* Is the site database bound to an explicit engine mode (`internal-docker`, `external-docker`, `external-remote`)?
* Is `nexpanel-db` (Postgres 16 panel metadata) kept isolated from any site operations?
* Are external engines protected from stop/restart/delete operations?

### Rule R3: CloudPanel Import
* Does the import flow validate that WordPress is not targeted at PostgreSQL?
* Is dry-run simulation executed before live database mutation?
* Is 1-click rollback registered in case of unexpected failure?

## 3. Fast In-Memory Development

For rapid iterative testing without running live PostgreSQL or Docker:
* Set `PANEL_DB_USE_MEMORY=true` in `.env` or run tests with `NODE_ENV=test`.
* `MemoryAdapter` simulates tables, transactions, and basic SQL operations in memory.
* To test live PostgreSQL migrations, spin up the lab: `npm run lab:up`.

## 4. CodeGraph Semantic Navigation

Before reading multiple files or using grep:
* Run `codegraph explore "<symbol or task>"` or call the `codegraph_explore` MCP tool.
* It returns verbatim on-disk code, call hierarchies, and affected test suites in one step.
