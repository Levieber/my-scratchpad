# Architecture

One rule shapes everything: **the HTTP API is the only way in.** People (PWA, CLI) and agents (MCP, curl, anything reading `/llms.txt`) use the same endpoints, so neither gets a capability the other lacks.

Everything but the PWA is written with Effect 4; why, and what it cost, is in [effect.md](effect.md).

```
src/
  server.ts       Serves the routes on BunHttpServer and starts it (`pad serve`): config, loopback/token check, JSON logs in production. The only HTTP entry point.
  routes.ts       The endpoints: `resource(path, { GET, … })`, `guard` (bearer check, error mapping), the health check.
  http.ts         What the routes share: reading a request (body, If-Match, query, paging) and writing a response or a refusal.
  observability.ts  A request id on every request and response, one log line per request carrying it, and the JSON logger.
  db.ts           Store service: notes and saved views in SQLite + FTS5 (effect/sql). Only the server uses it.
  migrations.ts   Named schema changes, recorded in schema_migrations.
  domain.ts       The API's shapes as Schemas (Note, NoteInput, Revision, View); every client shares the types.
  errors.ts       Error codes + messages; shared by server and clients.
  kinds.ts        Note kinds (note, reference); a use case is a tag, not a kind. Shared.
  query.ts        The search language (`kind:x author:x #tag words`); run by the server, edited by the PWA.
  checklist.ts    Markdown checkboxes → `progress` on every note.
  diff.ts         Line diffs (Myers), unified diff text, three-way merge. Server and PWA share it.
  ids.ts          Note ids; the PWA mints them too, for notes written offline (accepted ones: NoteId in domain.ts).
  title.ts        The title derived from a body's first line.
  openapi.ts      The contract (/openapi.json) and the agent quick-start (/llms.txt).
  config.ts       Every env var and the files in ~/.config/scratchpad (config.json from `pad login`, hooks.json from `pad hooks`), read in one place (Effect Config).
  client.ts       Client service over the HTTP API, used by the CLI, MCP server and Claude Code hooks.
  transfer.ts     `pad export` / `pad import`: notes as a JSON array (the shape of `pad ls --json`), built on the public API. Import keeps ids, so it is safe to repeat; author and timestamps are not carried over.
  cli.ts          `pad` (effect/cli): the commands and their `--json` output.
  format.ts       How `pad` prints a note for a person (one line, or in full).
  mcp.ts          MCP stdio server (effect/ai McpServer) — native tools for Claude Code.
  web/            React PWA (bundled by Bun from the web/index.html import); talks to the API via web/api.ts,
                  writes through the outbox in web/sync.ts.
public/           Files that must live at the site root: service worker, manifest, icon.
integrations/     Claude Code wiring: installer, hooks (run as `pad hook <name>`), skills.
test/support.ts   Fixtures: the production layers on an in-memory database, in a ManagedRuntime.
```

## Boundaries, enforced

`test/architecture.test.ts` fails the build when an import crosses a boundary, and says why:

- Clients (`src/web/**`, `cli.ts`, `mcp.ts`, `client.ts`, `integrations/**`) never import `db.ts`, `migrations.ts`, `bun:sqlite`, `server.ts`, `routes.ts` or `http.ts` at runtime — they go through HTTP. (`pad serve` may import the server: it launches it, it doesn't call it.)
- `src/web/**` imports no `bun`/`node:` modules and not `config.ts`/`client.ts`: it runs in a browser.
- Storage (`db.ts`, `migrations.ts`) knows nothing about HTTP (`server.ts`, `routes.ts`, `http.ts`, `client.ts`, `errors.ts`, `effect/http`).
- `src/web/**` imports no Effect: it stays out of the browser bundle.
- Effect modules are imported by path (`effect/Effect`), never through a barrel (`effect`, `effect/http`, `@effect/platform-bun`): Bun loads a whole barrel at runtime, ~30 ms on every `pad` and hook run.
- No `../`, tests included: `@/` is `src/`, `@integrations/` is `integrations/`, `./` is for a sibling.

A boundary holds however the module is written (`./db`, `../db`, `@/db`). Type-only imports are always fine: sharing `Note` couples nothing at runtime.

## Adding a capability

1. API first: a route in `routes` (`src/routes.ts`; request and response helpers are in `src/http.ts`), its schema in `src/openapi.ts` (and `/llms.txt` if agents should know), a test in `test/api.test.ts`. A new shape goes in `src/domain.ts`; a new storage outcome is a tagged error in `src/db.ts`, mapped in `guard`.
2. Then the clients that need it: `src/client.ts` (+ a `cli.ts` command, a `mcp.ts` tool), `src/web/api.ts`.

## Routes

`routes(token)` (`src/routes.ts`) is a layer adding an `HttpRouter` route per path: `resource(path, { GET, POST, … })` dispatches on the method, wraps each handler in `guard` (the bearer check and error mapping) and answers the methods a path doesn't define with `405` and an `Allow` header. Handlers are Effects that read the request (`HttpServerRequest`) and path params (`HttpRouter.params`); the store is yielded once, when the routes are built. `serverLayer` (`src/server.ts`) serves them, with `requestLogging` around every route, on `BunHttpServer`, with Bun itself serving the HTML import at `/` (HMR in development). `main` reads `ServerConfig`, refuses a non-loopback address without `PAD_TOKEN`, and launches it all with `BunRuntime.runMain`.

## Errors

Every non-2xx body is `{ "error": "<code>", "message": "<english>" }`. The code (from `src/errors.ts`, also an enum in `/openapi.json`) is the contract; the message is for people and agents reading raw responses.

- A handler refuses a request with `yield* refuse(code, status, detail?)`, an `HttpError`.
- The store fails with tagged errors (`NoteNotFound`, `NoteExists`, `NoteChanged`, `RevisionNotFound`, `ViewNotFound`, `ViewExists`, and `DatabaseUnavailable`, which only `ping` raises); `guard` maps each to its code and status, and the `Failure` type lists everything a handler may fail with.
- A defect (a bug, a broken database) is logged and answered with `500 internal`.

Clients get `ApiError` (`src/client.ts`) carrying the status and code.

## Observability

- **Request id.** Every response carries `x-request-id`: the platform's own (`x-railway-request-id`, then a caller's `x-request-id`) when it is a short run of plain characters, else one the server makes up. A line in the platform's access log therefore leads to ours. Anything else in the header is ignored, not cut down, since it is echoed back and logged.
- **One log line per request**: `request` with `requestId`, `method`, `path`, `status` and `durationMs` (level `ERROR` for a 5xx). The query string is never logged (it holds what the user searched for), nor is the Authorization header, and a healthy health check stays out. Everything logged while handling the request, a defect's cause included, carries the same `requestId`.
- **JSON in production.** With `NODE_ENV=production` the logger writes one JSON object per line (`message`, `level`, `timestamp`, `annotations`, and `cause` for failures); locally it stays human-readable. Read it with `railway logs --json | jq 'select(.annotations.requestId == "…")'`.
- **Health.** `GET /api/health` needs no token and reads a row of `notes` (`Store.ping`): `200 {"ok":true}`, or `503 unavailable` while the database can't answer, with the driver's error (`SQLITE_*` code and all) in the log, never in the body. Railway waits for it on every deploy.

Tests read what the server logs through `testServer().logs` instead of printing it.

## Storage and migrations

Notes live in one SQLite table with an FTS5 index kept in sync by triggers. `Store` is a service on `SqlClient` (`@effect/sql-sqlite-bun`, one connection); `Store.layer(path)` opens the file, turns on foreign keys and migrates before the store is handed out. Rows are decoded with Schemas; SQL failures are defects, so store signatures list only domain outcomes. Schema changes are named migrations in `src/migrations.ts`, applied in one transaction on startup and recorded in `schema_migrations`:

- Append to the end of `MIGRATIONS`; never edit, rename or reorder one that has shipped.
- The runner is ours, not effect/sql's `Migrator`, which keeps numeric ids in its own table.
- Only `0001` and `0002` use `IF NOT EXISTS` — that is how databases created before named migrations (including the live Railway one) adopt them. New migrations must not need it.

## History

Every create and every content change (title, body, tags, kind; not pinning) is written to `note_revisions` in the same transaction, attributed to the `X-Pad-Author` of that request. Saves by one author within `REVISION_WINDOW_MS` (5 minutes) fold into the latest revision, so an autosaving editor records editing sessions, not keystrokes; a folded revision that ends up equal to the one before it is dropped. Each revision stores its full content plus lines added/removed, so diffs are computed on read (`GET /api/notes/:id/diff`) and any revision can be restored with a plain PATCH. Deleting a note deletes its history.

## Concurrent and offline writes

A note's `updated_at` is its version: note responses carry it as `ETag`, and `PATCH` with `If-Match` answers `412 noteChanged` when the note moved on. `Store.update` always advances `updated_at` by at least a millisecond, so two writes never share a version. `POST` accepts a client-chosen `id` (`409 noteExists` if taken), which makes a create safe to retry.

Requests run concurrently, so every check-then-write (If-Match, append, create with an id) runs in one `sql.withTransaction`. `test/api.test.ts` races writes to hold that.

The PWA builds offline editing on those two rules (`src/web/sync.ts`):

- Every save goes into an **outbox** in localStorage first, with the version it started from; deletes too. The list shows the outbox applied, so notes written offline appear straight away.
- The **syncer** sends the outbox in order whenever it can (after a save, on each poll, on the `online` event, at startup). A `412` fetches the note, merges three-way (`merge3` in `src/diff.ts`, field by field for the rest) and retries. Where both sides changed the same lines, both are kept between git-style markers; both sides appending at one spot keeps both without markers.
- A note deleted elsewhere while edited here is recreated rather than losing the edit.
- The service worker serves cached GETs when the network is down and marks them with `x-pad-offline`, so the app can show that it is offline while still reading notes.

## Tooling

- `bun run lint` — oxlint (type-aware, incl. `no-deprecated` and jsx-a11y), oxfmt (formatting, sorted imports), knip (unused files/exports/deps), in parallel. `bun run lint:fix` fixes what it can.
- Change a lint rule with a scoped override and a comment giving the reason.
- `bunfig.toml`: dependencies are added with exact versions, and packages published less than a day ago are refused (`minimumReleaseAge`).
- `repos/` vendors upstream source for reference (Effect): `bun test` runs only `test/`, and every linter ignores it (oxlint also with `--disable-nested-config`, as `repos/effect` brings its own config).
- Tests build the production layers with `test/support.ts` (`testServer`, `testStore` with a `TestClock`) and run effects through the fixture's `run`.
