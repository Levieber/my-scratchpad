# Effect

Everything outside the PWA is written with [Effect](https://effect.website) 4 (`effect`, `@effect/platform-bun`, `@effect/sql-sqlite-bun`). This page records why, what each part became, the decisions behind it and what it cost. For idiomatic usage, read the vendored source in `repos/effect/` (start at `LLMS.md` and `ai-docs/`), not the web.

## Why

The code already had the shape Effect formalises, written by hand each time:

- **Errors as values.** `HttpError` thrown and caught by `resource()`, `Store` methods returning `null` for "not found", the client's `ApiError`, the CLI's `catch` around `main()`. A `null` doesn't say which thing was missing, and a thrown error isn't in any signature.
- **Dependencies passed by hand.** `createServer({ store, token })`, `new Client(url, author, token)`, `new Store(path, { now })` for a test clock, a module-level `config` read at import time.
- **Validation by hand.** `readInput` and `parseExport` checked the same fields with the same `typeof` chains; the MCP server described the same inputs again in zod.
- **Timeouts and cleanup by hand.** `withTimeout` raced a timer it then had to `process.exit` to escape.

Effect gives each of these one mechanism, checked by the compiler: failures in the type (`Effect<A, E, R>`), dependencies as services provided by layers (`R`), Schema for every boundary, and structured concurrency for timeouts and shutdown.

## What each part became

| Part                                 | Before                                       | Now                                                                                                                                                                  |
| ------------------------------------ | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shapes (`src/shared/domain.ts`, new) | TS types spread over `db.ts` and `server.ts` | Schemas; types derived from them. Requests and SQL rows are decoded with them.                                                                                       |
| Storage (`src/server/storage/`)      | `Store` class on `bun:sqlite`                | `Store` service on `SqlClient` (`@effect/sql-sqlite-bun`); fails with `NoteNotFound`, `NoteExists`, `NoteChanged`, `RevisionNotFound`, `ViewNotFound`, `ViewExists`. |
| Migrations                           | sync runner                                  | the same runner as an Effect; same table, ids and statements.                                                                                                        |
| HTTP (`src/server/`)                 | `Bun.serve` route table                      | `HttpRouter` on `BunHttpServer`; Bun still serves the HTML import (`/`).                                                                                             |
| Config (`src/config/`)               | `process.env` read at import                 | `Config`: `ServerConfig`, and a `ClientConfig` service.                                                                                                              |
| Client (`src/client/client.ts`)      | class over `fetch`                           | `Client` service on `HttpClient`, failing with a typed `ApiError`.                                                                                                   |
| CLI (`src/cli.ts`)                   | `node:util` `parseArgs` + `switch`           | `effect/cli` commands.                                                                                                                                               |
| MCP (`src/mcp.ts`)                   | `@modelcontextprotocol/sdk` + zod            | `effect/ai` `McpServer` with Schema tools.                                                                                                                           |
| Hooks                                | `withTimeout` + `process.exit`               | `Effect.timeout` + `Effect.ignoreCause` (`quietly`).                                                                                                                 |
| Tests                                | `new Store(":memory:")`, `createServer`      | `test/support.ts`: the production layers in a `ManagedRuntime`, `TestClock` for time.                                                                                |

The HTTP contract did not change: the API tests pass with only their setup rewritten.

## Decisions

**`HttpRouter`, not `HttpApi`.** `HttpApi` would derive `/openapi.json` and a typed client from one definition, but its defaults don't produce this API's contract: `{ error, message }` bodies with our codes, `invalidJson` vs `invalidBody`, `text/plain` bodies taken as the note, `405` with `Allow`, `If-Match`/`ETag`. Matching all of that means fighting the framework at every endpoint, and every client (PWA, CLI, MCP, agents reading `/llms.txt`) depends on it. `HttpRouter` keeps the contract byte for byte. `HttpApi` is the natural next step if the contract is ever allowed to move.

**One `*` route per path.** Each path is one route that dispatches on the method and answers others with `405` + `Allow`, as `resource()` did before. Relying on how find-my-way ranks per-method routes against `*` would have been less obvious.

**Our migrator, not `effect/sql`'s.** `Migrator` keeps numeric ids in its own table; the live database records string ids (`0001.notes`) in `schema_migrations`. Only the runner changed; no shipped migration was edited.

**SQL failures are defects.** A `SqlError` means the database is broken, and no caller can do better than answer `internal`. The store turns them into defects (`run` in `server/storage/sql.ts`), so its signatures list only domain outcomes. The server logs a defect and answers `500 internal`, as it did for a thrown error.

**Transactions where the old code relied on being synchronous.** `bun:sqlite` calls were synchronous, so "check, then write" could not interleave with another request. Effect runs requests as concurrent fibers. If-Match, append and create-with-id now check and write in one `sql.withTransaction`, which holds the single connection. `test/api.test.ts` fires 25 parallel appends and two racing If-Match writes. Without the transaction, appends are lost and the test fails.

**Responses aren't decoded.** The client trusts response shapes (typed, not validated). The CLI and the deployed server are often different versions (the live server still returns `pinned`), and a field one side doesn't know must not become a failure. Requests, rows and imports are decoded.

**Validation messages kept.** Schema's own messages name the innermost failure (`Expected string at ["tags"][0]`). `inputProblem` maps a failure to the field's one-line rule (`tags must be an array of strings`), so API errors and `pad import` read as before.

**The PWA stays as it is.** Its state is React's, and its offline outbox (`web/lib/sync.ts`) is already explicit and tested. Effect would add to the bundle a browser has to download, for little gain. The browser imports domain types type-only, so no Effect code reaches it (the build is byte-identical). `test/architecture.test.ts` keeps it that way.

**Modules by path, never a barrel.** `import { Effect } from "effect"` loads every module Effect has: Bun doesn't tree-shake at runtime. Measured on the SessionStart hook, that was 99 ms against 71 ms with `import * as Effect from "effect/Effect"`. The architecture test refuses barrel imports (`effect`, `effect/http`, `@effect/platform-bun`, …).

**Tests stay on `bun test`.** `@effect/vitest` would add vitest. Instead, `test/support.ts` builds the production layers into a `ManagedRuntime` per test and runs effects with `runPromise`. Time is a `TestClock` the test moves.

## Benefits

- **Failures are in the types.** A handler that forgets a store outcome doesn't compile: `guard` in `server/resource.ts` lists every failure it maps to a response.
- **One schema per shape.** The same `NoteInput` validates the API body, the import file and the derived TypeScript type. MCP tool inputs are Schemas too, so their JSON Schema is generated, not written again in zod.
- **Dependencies are explicit and swappable.** Tests provide an in-memory store, a `TestClock` or a `ConfigProvider` instead of mutating `process.env` or passing `now` callbacks.
- **Config fails loudly.** `PAD_PORT=abc` was `NaN`; now startup fails and says why. Tokens are `Redacted`, so a logged config shows `<redacted>`.
- **Fewer runtime dependencies.** The MCP SDK (express, hono, ajv, jose and 13 more direct dependencies) and zod are gone from runtime. `effect` has no dependencies; `@effect/platform-bun` adds only `ws`. This fits the supply-chain caution in `bunfig.toml`. The SDK remains a dev dependency, as the reference client in `test/mcp.test.ts`.
- **Better CLI errors and help.** `--kind memo` and `-n abc` are refused with the allowed values, and `pad <command> --help` works for every command.
- **Shutdown is structured.** `BunRuntime.runMain` interrupts the server on SIGINT/SIGTERM (what Railway sends on a redeploy) and runs finalizers: the database is closed, which SQLite shows by removing its `-wal` file. Hooks no longer `process.exit` to escape a pending timer.
- **More tests.** New: config rules, MCP end to end, concurrent writes, the clock, the new boundaries (125 → 220 tests, many of the new ones per-file architecture checks), and the compiled `pad` built and run in a test.

## Costs

- **Startup time.** Run from source, the SessionStart hook went from ~13 ms to ~73 ms, and `pad status` from ~11 ms to ~109 ms (median of 15, server unreachable). Bun transpiles and resolves each of the ~150 modules on every run, and Effect's HTTP client and `Config` both load Schema. Next to a model turn it's noise; in a tight shell loop of `pad` calls it adds up. Building wins most of it back (same measurement):

  | Hook built as                                   | Time   | Size   |
  | ----------------------------------------------- | ------ | ------ |
  | `bun build --target=bun --minify`               | ~27 ms | 140 KB |
  | `bun build --compile --minify --bytecode` (exe) | ~15 ms | ~84 MB |

  Bytecode without `--compile` needs CommonJS, which a dependency's `import.meta` rules out. So `bun run setup:claude` compiles `pad` (`bun run build:pad`, the hooks being `pad hook <name>`): a hook or `pad status` takes ~25 ms (median of 15), ~10 ms more than a hook-only executable because the whole CLI loads. The catch is that the executable must be rebuilt after a code change ([claude-code.md](claude-code.md)).

- **Size.** `effect` is 54 MB installed (sources, maps and types). Nothing ships to the browser.
- **A new release.** 4.0.0 was published on 2026-10-01; early bugs are likely, and some modules (`http`, `cli`, `ai`) are marked unstable. Versions are pinned exactly.
- **Learning curve.** Generators, layers and services are a new vocabulary for contributors; `repos/effect` and this page are the way in.
- **CLI surface changed.**
  - `pad --help` is generated, and lists Effect's own flags (`--version`/`-v`, `--completions`, `--wizard`, `--log-level`).
  - Text starting with `-` needs `--` (`pad append <id> -- "- [ ] item"`); the old CLI crashed on it.
  - `pad search` is gone: a command takes one alias, `list`, and `ls` is the name.
- **Small output changes.**
  - MCP tool results are compact JSON (they were pretty-printed), plus `structuredContent` where the result is an object.
  - The server's startup line goes through Effect's logger (`[time] INFO (#1): scratchpad listening on …`).

## Where to go next

- `HttpApi` for a generated `/openapi.json` and a derived typed client, if the API's contract may move.
- Decode responses in the client once the deployed server is on this version.
- Spans: `Effect.fn("name")` instead of `fnUntraced` on the request path, with an OpenTelemetry exporter, if Railway logs stop being enough.
