# Backend Development Guidelines (`@nexpanel/backend`)

## Architecture & Technology
- **Runtime**: Node.js v22+ (v24), TypeScript 5.7+ in pure ESM (`"type": "module"`).
- **Web Framework**: Fastify v5 with `@fastify/sensible`, `@fastify/cors`, `@fastify/swagger`.
- **Validation**: Zod 3.24 for all request params, bodies, querystrings, and environment variables.
- **Database Abstraction**:
  - `DatabaseAdapter` interface (`src/db/db.ts`).
  - `MemoryAdapter` (`src/db/memory-adapter.ts`): Active in `NODE_ENV=test` or `PANEL_DB_USE_MEMORY=true`. Runs completely in RAM for rapid testing without external DB dependency.
  - `PgAdapter` (`src/db/pg-adapter.ts`): Connects to PostgreSQL 16 panel metadata database.
- **Security & Vault**:
  - `VaultService` (`src/vault/vault.ts`): AES-256-GCM encryption with `vault:enc:v1:` prefix.
  - Key stored in `data/panel/vault.key` (0o600 permissions).
  - Use `VaultService.sanitizeObject()` on any data sent to logs or audit tables.
- **Authentication & RBAC**:
  - `auth-guard.ts`: Fastify preHandler enforcing JWT verification and role permissions.
  - Roles: `admin`, `site_manager`, `user`, `client` (`src/rbac/rbac.ts`).
  - Brute force lockout: 5 failed attempts locks user for 15 minutes (`NFR-SEC-06`).
  - TOTP 2FA: `TotpService` (`src/auth/totp.ts`).
- **Edge / NPM Integration (R1)**:
  - `src/edge/npm-client.ts`: Talks to external NPM API.
  - `src/edge/proxy-queue.ts`: Queues proxy mutations when NPM is down.
  - `src/edge/drift-reconciler.ts`: Compares panel sites against NPM proxy hosts and fixes drift.
  - Hard Rule R1: Forward hosts must be Docker container names, never `localhost` or `127.0.0.1`.
- **Database Engines (R2)**:
  - `src/db-engines/engine-registry.ts`: Manages `internal-docker`, `external-docker`, `external-remote`.
  - Hard Rule R2: External engines cannot be modified, stopped, or deleted by the panel.
- **CloudPanel Importer (R3)**:
  - `src/importer/tar-inspector.ts`: Inspects `backup.tar` or local archive pair.
  - `src/importer/dry-run-simulator.ts`: Computes diff and blocks WordPress on PostgreSQL.
  - `src/importer/rollback-service.ts`: Atomic rollback cleaning up sites, DBs, and vhosts.

## Testing Guidelines
- All tests live in `test/` (`m1-integration.test.ts` to `m7-cloudpanel-import.test.ts`).
- Run with: `npm test` or `node --import tsx --test --test-concurrency=1 test/*.test.ts`.
- **Strict Concurrency Rule**: Always use `--test-concurrency=1` to prevent shared state conflicts in `MemoryAdapter` and port collisions.
