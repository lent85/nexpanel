# NexPanel — Claude Code Guidelines

Refer to [AGENTS.md](file:///D:/Projects/#dev.support/cloudpanellite/AGENTS.md) for complete architecture specifications, the 3 non-negotiable hard rules (R1, R2, R3), and coding standards.

## Quick Reference
- **Test suite**: `npm test`
- **Typecheck**: `npm run typecheck`
- **Build**: `npm run build`
- **Code Intelligence**: Use CodeGraph (`codegraph explore "<query>"`) for symbol & call-tree inspection.
- **ESM requirement**: Relative imports require explicit `.js` extensions.
