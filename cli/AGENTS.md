# CLI Development Guidelines (`@nexpanel/cli` — `nxctl`)

## Architecture & Technology
- **Runtime**: Node.js v22+ (v24), TypeScript 5.7+ pure ESM.
- **CLI Framework**: Commander v13 (`src/bin/nxctl.ts`).
- **Binary**: `dist/bin/nxctl.js` (registered in `package.json` `"bin": { "nxctl": "./dist/bin/nxctl.js" }`).
- **Client**: `src/client.ts` (`NexPanelClient`) communicates with the backend REST API.

## Command Organization
- `user:*`: `user:add`, `user:list`, `user:reset:password`, `user:disable:mfa`
- `site:*`: `site:create`, `site:list`, `site:delete`, `site:restore`
- `db:*`: `db:create`, `db:list`, `db:export`, `db:import`, `db:backup`
- `proxy:*`: `proxy:sync`, `proxy:reconcile`
- `backup:*`: `backup:panel`, `backup:site`
- `panel:*`: `panel:basic-auth:enable`, `panel:basic-auth:disable`
- `import:cloudpanel`: Executes CloudPanel migration with `--dry-run` or `--rollback-on-failure`.

## Strict Output Contract
Every command MUST support the `--json` option:
1. When `--json` is supplied:
   - Output must be valid JSON to `stdout`.
   - Never write human logs or progress spinners to `stdout` in JSON mode.
2. When `--json` is omitted:
   - Output human-readable formatted text or tables.
3. On error:
   - Exit with code `1`.
   - If `--json` was requested, output `{ "error": "...", "code": ... }` to `stdout` or write error to `stderr`.

## Testing Guidelines
- Tests live in `test/nxctl.test.ts`.
- Run with: `npm test` or `node --import tsx --test test/*.test.ts`.
- Tests spawn `nxctl.ts` via Node child process and assert both stdout JSON and exit codes.
