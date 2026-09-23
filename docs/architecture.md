# Architecture

One rule shapes everything: **the HTTP API is the only way in.** People (PWA, CLI) and agents (MCP, curl, anything reading `/llms.txt`) use the same endpoints, so neither gets a capability the other lacks.

```
src/
  server.ts       Bun.serve route table: auth, validation, error codes. The only HTTP entry point.
  db.ts           Store: notes in SQLite + FTS5. Only the server uses it.
  migrations.ts   Named schema changes, recorded in schema_migrations.
  errors.ts       Error codes + messages; shared by server and clients.
  openapi.ts      The contract (/openapi.json) and the agent quick-start (/llms.txt).
  config.ts       Every env var and ~/.config/scratchpad/config.json, read in one place.
  client.ts       Typed HTTP client used by the CLI, MCP server and Claude Code hook.
  cli.ts          `pad` — human-friendly and `--json` output.
  mcp.ts          MCP stdio server — native tools for Claude Code.
  web/            React PWA (bundled by Bun from the web/index.html import); talks to the API via web/api.ts.
public/           Files that must live at the site root: service worker, manifest, icon.
integrations/     Claude Code wiring (installer, SessionStart hook, skill).
```

## Boundaries, enforced

`test/architecture.test.ts` fails the build when an import crosses a boundary, and says why:

- Clients (`src/web/**`, `cli.ts`, `mcp.ts`, `client.ts`, `integrations/**`) never import `db.ts`, `migrations.ts`, `bun:sqlite` or `server.ts` at runtime — they go through HTTP. (`pad serve` may import the server: it launches it, it doesn't call it.)
- `src/web/**` imports no `bun`/`node:` modules and not `config.ts`/`client.ts`: it runs in a browser.
- Storage (`db.ts`, `migrations.ts`) knows nothing about HTTP.

Type-only imports are always fine: sharing `Note` couples nothing at runtime.

## Adding a capability

1. API first: a route in `createRoutes` (`src/server.ts`), its schema in `src/openapi.ts` (and `/llms.txt` if agents should know), a test in `test/api.test.ts`.
2. Then the clients that need it: `src/client.ts` (+ `cli.ts`, `mcp.ts` tool), `src/web/api.ts`.

## Routes

`createRoutes` returns Bun's route table: one entry per path, one handler per method. `resource()` wraps each handler with the bearer check and error mapping, and answers methods a path doesn't define with `405` and an `Allow` header (Bun would otherwise fall through to 404). Path params arrive decoded in `req.params`.

## Errors

Every non-2xx body is `{ "error": "<code>", "message": "<english>" }`. The code (from `src/errors.ts`, also an enum in `/openapi.json`) is the contract; the message is for people and agents reading raw responses. Throw `new HttpError(code, status, detail?)` inside a handler; `resource()` turns it into the response.

## Storage and migrations

Notes live in one SQLite table with an FTS5 index kept in sync by triggers. Schema changes are named migrations in `src/migrations.ts`, applied in one transaction on startup and recorded in `schema_migrations`:

- Append to the end of `MIGRATIONS`; never edit, rename or reorder one that has shipped.
- Only `0001` and `0002` use `IF NOT EXISTS` — that is how databases created before named migrations (including the live Railway one) adopt them. New migrations must not need it.

## Tooling

- `bun run lint` — oxlint (type-aware, incl. `no-deprecated` and jsx-a11y), oxfmt (formatting, sorted imports), knip (unused files/exports/deps), in parallel. `bun run lint:fix` fixes what it can.
- Change a lint rule with a scoped override and a comment giving the reason.
- `bunfig.toml`: dependencies are added with exact versions, and packages published less than a day ago are refused (`minimumReleaseAge`).
