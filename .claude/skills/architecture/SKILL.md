---
name: architecture
description: How my-scratchpad is structured and the API-first rule. Use before adding an endpoint, a CLI command, an MCP tool or a PWA feature; when touching anything in src/server/ (routes, storage, migrations), src/shared/domain.ts or src/shared/errors.ts; when writing Effect code here; when changing lint config; or when test/architecture.test.ts fails.
---

# Architecture

The reasoning is in `docs/architecture.md`, and for Effect in `docs/effect.md`. Update them in the same change when a rule here moves.

## The rule

The HTTP API is the only way in. Each folder of `src/` is one responsibility: `shared/` (pure, used by everyone, imports no process), `server/` (the API; `server/storage/` is the only code that touches SQLite), `client/`, `config/`, `cli/`, `mcp/`, `web/`. Clients (`web/`, `cli.ts` + `cli/`, `mcp.ts` + `mcp/`, `client/`, `integrations/`) never import `server/` at runtime (type-only imports are fine). `web/` imports no `bun`/`node:` modules, not `config/`/`client/`, and no Effect. Storage imports nothing else of `server/`. The three entry points (`src/server.ts`, `cli.ts`, `mcp.ts`) stay at the root: installed units and registrations name them. `test/architecture.test.ts` enforces all of it.

## Imports

- Never `../`: `@/` is `src/`, `@integrations/` is `integrations/`, `@test/` is `test/`; `./` only for a sibling in the same folder.
- Effect by module path: `import * as Effect from "effect/Effect"`, `effect/http/HttpRouter`, `@effect/platform-bun/BunHttpServer`. Never a barrel (`effect`, `effect/http`, …): Bun loads all of it, ~30 ms per `pad`/hook run.
- For Effect idioms, read `repos/effect/` (`LLMS.md`, `ai-docs/`), not the web.

## Adding a capability

1. A shape in `src/shared/domain.ts` (Schema; the type derives from it).
2. Storage in `src/server/storage/`: a method in the file of its area (`notes.ts`, `revisions.ts`, `views.ts`; `store.ts` composes them); a domain outcome is a `Schema.TaggedError` in `errors.ts`, SQL failures stay defects (`run` in `sql.ts`). Check-then-write goes in `sql.withTransaction`.
3. Route in `server/routes.ts` via `resource(path, { GET, POST, … })` (`resource.ts`): it adds the bearer check, `guard`'s error mapping and 405 + `Allow`. Reading a request and answering are helpers in `server/http.ts`. Refuse with `yield* refuse(code, status, detail?)`; map a new store error in `guard` (and the `Failure` type in `http.ts`).
4. Schema in `server/docs/openapi.ts`; mention in `docs/llms.ts` if agents should use it.
5. Test in `test/server/api.test.ts` (`testServer()` from `@test/support`: the real server on port 0; `server.run` reaches the Store and SQL).
6. Then clients: `client/client.ts` (a method on the `Client` service) → a command in `cli/commands/` (`effect/cli`) / a tool in `mcp/tools.ts` with its handler in `mcp/handlers.ts`, and `web/lib/api.ts`.

## Errors

Codes live in `src/shared/errors.ts` (add new ones there); bodies are `{ error: code, message }`. Clients fail with `ApiError` (status, code, message) from `src/client/client.ts`; the PWA reads bodies with `readError()`.

## Schema changes

Append a `{ id: "000N.name", statements }` to `MIGRATIONS` in `src/server/storage/migrations.ts`. Never edit, rename or reorder a shipped one. Don't use `IF NOT EXISTS` in new ones. Add a test in `test/server/migrations.test.ts` if it transforms data (`onFreshDb` + `migrateWith`).

## Check

```bash
bun test && bun run lint && bun run typecheck
```

Fix lint findings rather than disabling rules; if a rule must change, use a scoped override in `oxlint.config.ts` with a comment giving the reason.
