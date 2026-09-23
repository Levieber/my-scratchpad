---
name: architecture
description: How my-scratchpad is structured and the API-first rule. Use before adding an endpoint, a CLI command, an MCP tool or a PWA feature; when touching src/server.ts, src/db.ts, src/migrations.ts or src/errors.ts; when changing lint config; or when test/architecture.test.ts fails.
---

# Architecture

The reasoning is in `docs/architecture.md`. Update it in the same change when a rule here moves.

## The rule

The HTTP API is the only way in. Clients — `src/web/**`, `src/cli.ts`, `src/mcp.ts`, `src/client.ts`, `integrations/**` — never import `db.ts`, `migrations.ts`, `bun:sqlite` or `server.ts` at runtime (type-only imports are fine). `src/web/**` imports no `bun`/`node:` modules and not `config.ts`/`client.ts`. Storage imports nothing HTTP. `test/architecture.test.ts` enforces all of it.

## Adding a capability

1. Route in `createRoutes` (`src/server.ts`) via `resource({ GET, POST, … })` — it adds the bearer check, error mapping and 405 + `Allow`.
2. Schema in `src/openapi.ts`; mention in `/llms.txt` if agents should use it.
3. Test in `test/api.test.ts` (real `Bun.serve` on port 0 via `createServer`).
4. Then clients: `src/client.ts` → `cli.ts` / `mcp.ts`, and `src/web/api.ts`.

## Errors

Throw `new HttpError(code, status, detail?)`. Codes live in `src/errors.ts` (add new ones there); bodies are `{ error: code, message }`. Clients read them with `readError()`.

## Schema changes

Append a `{ id: "000N.name", statements }` to `MIGRATIONS` in `src/migrations.ts`. Never edit, rename or reorder a shipped one. Don't use `IF NOT EXISTS` in new ones. Add a test in `test/migrations.test.ts` if it transforms data.

## Check

```bash
bun test && bun run lint && bun run typecheck
```

Fix lint findings rather than disabling rules; if a rule must change, use a scoped override in `oxlint.config.ts` with a comment giving the reason.
