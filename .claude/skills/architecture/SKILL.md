---
name: architecture
description: How my-scratchpad is structured and the API-first rule. Use before adding an endpoint, a CLI command, an MCP tool or a PWA feature; when touching src/server.ts, src/db.ts, src/domain.ts, src/migrations.ts or src/errors.ts; when writing Effect code here; when changing lint config; or when test/architecture.test.ts fails.
---

# Architecture

The reasoning is in `docs/architecture.md`, and for Effect in `docs/effect.md`. Update them in the same change when a rule here moves.

## The rule

The HTTP API is the only way in. Clients — `src/web/**`, `src/cli.ts`, `src/mcp.ts`, `src/client.ts`, `integrations/**` — never import `db.ts`, `migrations.ts`, `bun:sqlite` or `server.ts` at runtime (type-only imports are fine). `src/web/**` imports no `bun`/`node:` modules, not `config.ts`/`client.ts`, and no Effect. Storage imports nothing HTTP. `test/architecture.test.ts` enforces all of it, however a module is written (`./db`, `@/db`).

## Imports

- Never `../`: `@/` is `src/`, `@integrations/` is `integrations/`; `./` only for a sibling.
- Effect by module path: `import * as Effect from "effect/Effect"`, `effect/http/HttpRouter`, `@effect/platform-bun/BunHttpServer`. Never a barrel (`effect`, `effect/http`, …): Bun loads all of it, ~30 ms per `pad`/hook run.
- For Effect idioms, read `repos/effect/` (`LLMS.md`, `ai-docs/`), not the web.

## Adding a capability

1. A shape in `src/domain.ts` (Schema; the type derives from it).
2. Storage in `src/db.ts`: a `Store` method on `sql`; a domain outcome is a `Schema.TaggedError`, SQL failures stay defects (`run`). Check-then-write goes in `sql.withTransaction`.
3. Route in `routes` (`src/server.ts`) via `resource(path, { GET, POST, … })`: it adds the bearer check, `guard`'s error mapping and 405 + `Allow`. Refuse with `yield* refuse(code, status, detail?)`; map a new store error in `guard` (and the `Failure` type).
4. Schema in `src/openapi.ts`; mention in `/llms.txt` if agents should use it.
5. Test in `test/api.test.ts` (`testServer()` from `test/support.ts`: the real server on port 0; `server.run` reaches the Store and SQL).
6. Then clients: `src/client.ts` (a method on the `Client` service) → a `cli.ts` command (`effect/cli`) / a `mcp.ts` tool (`Tool.make` + handler in `Handlers`), and `src/web/api.ts`.

## Errors

Codes live in `src/errors.ts` (add new ones there); bodies are `{ error: code, message }`. Clients fail with `ApiError` (status, code, message) from `src/client.ts`; the PWA reads bodies with `readError()`.

## Schema changes

Append a `{ id: "000N.name", statements }` to `MIGRATIONS` in `src/migrations.ts`. Never edit, rename or reorder a shipped one. Don't use `IF NOT EXISTS` in new ones. Add a test in `test/migrations.test.ts` if it transforms data (`onFreshDb` + `migrateWith`).

## Check

```bash
bun test && bun run lint && bun run typecheck
```

Fix lint findings rather than disabling rules; if a rule must change, use a scoped override in `oxlint.config.ts` with a comment giving the reason.
