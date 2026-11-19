# NexPanel — Antigravity Agent Guidelines

See [AGENTS.md](file:///D:/Projects/#dev.support/cloudpanellite/AGENTS.md) for full architecture details, coding standards, and specification mappings.

## Core Directives for Antigravity Agent

1. **Adhere to the 3 Hard Rules**:
   - **R1**: NexPanel NEVER binds ports 80/443. External NPM 2.16.0 owns them. Forward hosts must be Docker container names, never `localhost` / `127.0.0.1`.
   - **R2**: Databases are pluggable (`internal-docker`, `external-docker`, `external-remote`). Panel metadata DB (PostgreSQL 16) is strictly private.
   - **R3**: CloudPanel import requires dry-run diff, blocks WordPress on PostgreSQL, and provides 1-click rollback.
2. **Use CodeGraph First**:
   - The repository is indexed by CodeGraph (`.codegraph/` exists).
   - Reach for `codegraph_explore` (or shell `codegraph explore "<query>"`) BEFORE using grep or reading files.
3. **Pure ESM Standards**:
   - Every relative import in TypeScript must have `.js` extension (e.g. `import { foo } from './foo.js'`).
4. **Secret Sanitization**:
   - Never log or return unencrypted secrets. All sensitive keys use `VaultService` (`backend/src/vault/vault.ts`).
5. **Quality Gate**:
   - Always run `npm run typecheck` and `npm test` before concluding your turn.
