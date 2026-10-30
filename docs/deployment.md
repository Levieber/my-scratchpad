# Configuration and deployment

## Configuration

Every variable is read in `src/config/` (`env.ts` has what the configs share), as Effect `Config`: a value that is set but malformed (`PAD_PORT=abc`) stops startup with the reason instead of being used, an empty one counts as unset, and tokens are `Redacted`, so they never show in a log.

| Var                    | Default                            |                                                                          |
| ---------------------- | ---------------------------------- | ------------------------------------------------------------------------ |
| `PAD_PORT` / `PORT`    | 7777                               | `PORT` (set by Railway) also switches the bind host to `0.0.0.0`         |
| `PAD_HOST`             | 127.0.0.1                          |                                                                          |
| `PAD_DB`               | `~/.local/share/scratchpad/pad.db` | `/data/pad.db` on Railway                                                |
| `PAD_TOKEN`            | –                                  | server: required when not on loopback; clients: the token to send        |
| `PAD_MAX_IMPORT_BYTES` | 67108864 (64 MiB)                  | server: the most one import may send (`POST /api/import`, over it `413`) |
| `PAD_URL`              | from `pad login`, else local       | clients only                                                             |
| `PAD_AUTHOR`           | `human` / `claude-code` / `claude` | attribution on writes (`claude` for the MCP server over HTTP)            |
| `NODE_ENV`             | –                                  | `production` disables HMR and builds the PWA at start (see below)        |

Clients (CLI, MCP server, SessionStart hook) prefer `pad login <url> <token>`, which writes `~/.config/scratchpad/config.json` (mode 600). Env vars override it.

The MCP server over HTTP (`src/mcp-http.ts`, for claude.ai's connectors, see [claude-ai.md](claude-ai.md)) is a client too: `PAD_URL` and `PAD_TOKEN` (required) say which API it calls. It also reads:

| Var                     | Default                                         |                                                                             |
| ----------------------- | ----------------------------------------------- | --------------------------------------------------------------------------- |
| `PORT` / `PAD_MCP_PORT` | 7778                                            | `PORT` first (the platform's), and it binds `0.0.0.0`; `PAD_HOST` overrides |
| `PAD_MCP_URL`           | `https://$RAILWAY_PUBLIC_DOMAIN`, else loopback | the origin claude.ai reaches it at (no path): the OAuth issuer and resource |
| `PAD_OAUTH_SECRET`      | derived from `PAD_TOKEN`                        | signs the connectors' tokens; a new one signs every connector out           |

## Logs

With `NODE_ENV=production` (Railway) the server logs one JSON object per line: a `request` line per request (`requestId`, `method`, `path`, `status`, `durationMs`; no query string, no token) and the cause of every failure, all sharing the `requestId` that is also the response's `x-request-id` header and, when Railway sent one, its `x-railway-request-id`. Find the error behind a 5xx from the platform's access log:

```sh
railway logs --json | jq -c 'select(.annotations.requestId == "<id>")'
railway logs --json | jq -c 'select(.level == "ERROR")'
```

Locally the log stays human-readable.

## Running

- `bun run dev` — HMR, and browser console output streamed to the terminal.
- `bun run start` — `sh scripts/start.sh server`: sets `NODE_ENV=production`, builds the server into one executable with bytecode, the PWA inside it (`scripts/build.ts server` → `dist/pad-server`, under a second, in a process of its own), and `exec`s it, so the shell is replaced and nothing stays beside it. It builds at every start, so a pulled change is never served as the old build, and needs nothing from the platform's build step. If the build fails it runs `bun src/server.ts` instead. Run from source in production, the server first builds the PWA into `dist/web` in a process of its own and serves it from disk (`src/server/pwa-build.ts`), so the bundler and Tailwind's compiler (the plugin `bunfig.toml` names) never stay in it; where it can't (a tree that can't be written) it logs a warning and Bun bundles on the first request. SIGINT/SIGTERM (a Railway redeploy) shut it down gracefully: requests are interrupted, the database is closed and the process exits 0 (`teardown` in `src/server/serve.ts`). Exiting non-zero on a signal would make the on-failure restart policy report every redeploy as a crash.
- `bun run start:mcp` — `sh scripts/start.sh mcp`: the MCP server over HTTP, built and run the same way (`dist/pad-mcp`). It keeps nothing on disk and shuts down on a signal as the server does.
- Railway runs `sh scripts/start.sh …` itself rather than `bun run start`: `bun run` waits for its script, so it stays resident beside the server (~10 MB) for nothing.
- `bun run build` — bundle the PWA into `dist/web` (`scripts/build.ts web`), in chunks; run it to inspect the output and its size. `scripts/builds.ts` holds what each build bundles, and the tests build the PWA from it, so what they check is what ships.

## Memory and egress

Measured with a production server (`NODE_ENV=production`) on a fresh database of 1 000 notes of about 2 KB, Bun 1.4. Railway bills memory held and outbound traffic, so both are recorded.

| What                                                               | Before                           | After                        |
| ------------------------------------------------------------------ | -------------------------------- | ---------------------------- |
| RSS at start, before the first page request                        | 67 MB                            | 67 MB                        |
| RSS after the page is loaded once and the notes are in             | 160 MB                           | 96 MB (−40 %)                |
| 1 000 polls of `GET /api/notes` (50 notes, 117 KB)                 | 117 MB, p95 2.67 ms              | 117 KB, p95 0.33 ms          |
| One visible tab, nothing changing: list + tags + views + pins/tick | ~118 KB per 5 s, ~85 MB per hour | headers only, <1 MB/h (est.) |

- **Memory.** Bun bundles the PWA on the first request and keeps the bundler and Tailwind's compiler for as long as the process runs: 82 MB with nothing else going on. Prebuilding takes it out of the server.
- **Polls.** The PWA asks for the list, tags, views and pins every 5 s while a tab is visible. Those four answer with a weak `ETag` and `Cache-Control: private, no-cache`; the browser's own cache sends it back as `If-None-Match`, and the server answers `304` without reading a note (`polled` in `src/server/http.ts`). The version is SQLite's `total_changes()` and `data_version` plus an id per start (`src/server/storage/version.ts`), one trivial query. It moves on any write, not only to that collection, so a poll after an unrelated write is answered in full: that is the safe side. `test/e2e/polling.test.ts` counts the statuses in a real Chrome, with and without the service worker.
- **Compression is not the app's job on Railway.** Its edge gzips the HTML, the JS bundle (637 KB → 212 KB on the wire) and the API's JSON (the real list of 37 notes: 147 KB → 57 KB), so the app does not compress. The hashed JS and CSS are `immutable`, so a repeat visit does not fetch them. Behind a proxy that doesn't compress, add that to the proxy.
- **Not done**: a preview-only list (`?fields=preview`) would shrink the answer when something did change (bodies are 91 % of it), and slower polls for views and pins would save a few requests. With the 304 the idle cost is already near zero, so both wait for a number that says otherwise.

Then the servers as executables and the PWA in chunks (2026-10-30, same database, Bun 1.4.4; "after work" is 300 full list answers, 100 searches, 3 exports and the docs; each figure the middle of three runs):

| What                                                         | From source, `bun run start`  | Executable, `scripts/start.sh`       |
| ------------------------------------------------------------ | ----------------------------- | ------------------------------------ |
| Server RSS at start (all processes)                          | 72 MB (62 + 10 of `bun run`)  | 54 MB (−25 %)                        |
| Server RSS after the page is loaded                          | 67 MB                         | 59 MB                                |
| Server RSS after work / its peak                             | 90 MB / 133 MB                | 83 MB / 123 MB                       |
| MCP server over HTTP at start                                | 68 MB (+10 of `bun run`)      | 54 MB                                |
| Ready to answer                                              | ~300 ms (the PWA built first) | ~830 ms (the executable built)       |
| JS the page runs as it opens                                 | 832 KB, one file              | 672 KB (−19 %)                       |
| JS fetched when idle, run only when that part opens          | –                             | 93 KB in 5 chunks                    |
| `pad serve`'s page script (React's development build before) | 1 394 KB                      | 757 KB, one file (`pad` isn't split) |

- **Where a server's memory goes.** Bare Bun serving one route is 17 MB; importing `effect/Effect` makes it 31 MB, the HTTP, platform and SQL modules 48 MB, all of this project's server code 50 MB. So the startup cost is Effect's module graph as Bun loads it from source, file by file; one minified bundle loads less of it, and our own modules are ~2 MB, too little for lazy imports in the server to matter. An executable with bytecode measured 53 MB, without bytecode 55, a plain minified bundle run by `bun` 49: chosen is the executable, which needs no working directory to find its PWA (the plain bundle's HTML import resolves its files from the current one), carries the PWA built, and starts in ~40 ms once built. `bun --smol` changed nothing.
- **What the server grows to.** Full list answers grow the heap to its working size (about 25 MB more over the first thousand), then slowly, about 1.7 MB per thousand more; an export is a transient peak (about 38 MB for three in a row), given back afterwards.
- **The PWA in chunks.** What opens later (Settings, History, the table, the markdown renderer and its highlighter) is behind `React.lazy` and built as chunks of its own (`splitting`, `scripts/builds.ts`). The page names them as `<link rel="prefetch">` (`builtFiles` in `src/server/pages.ts`): the browser fetches them when idle without running them, and the service worker, which caches only what passes through it, has them for when the device is offline (`test/e2e/chunks.test.ts`). Effect is kept out of the bundle by `test/web/bundle.test.ts`, which sees what an import chain pulls in: one regex taken from `shared/domain.ts` had pulled in 78 KB of Schema.
- **Not done, measured**: streaming the export would lower its peak, but it reads in one transaction so its pages agree, and holding SQLite's one connection while a slow client downloads would stall every other request; an export is rare and its memory comes back. `cn`'s configurable build (73 KB minified) is a choice recorded in `src/web/lib/utils.ts`.

## Railway

Infrastructure as Code in `.railway/railway.ts`; `.railway/package.json` pins the `railway/iac` DSL and `.railway/` is its own mini-project (own tsconfig, ignored by the root tsconfig and knip). Don't add `railway.json`/`railway.toml` — config-as-code is deprecated and stops being read on 2026-12-01 — and don't add a `Dockerfile`: Railpack builds the app and picks Bun up from `bun.lock`.

It declares two services, both deployed from `github.com/Levieber/my-scratchpad` on every push to `main`. `web` is the API and the PWA, started with `sh scripts/start.sh server` (what `bun run start` runs, without `bun run` staying resident), with:

- a 1 GB volume at `/data` holding the SQLite file — that volume _is_ the database, so exactly one replica;
- a `/api/health` healthcheck, which reads the database: a deploy whose volume can't be queried never goes live (see [Observability](architecture.md#observability));
- `PAD_TOKEN` via `preserve()`: set once in Railway, never in the repo. The server refuses to start publicly without it.

`mcp` is the MCP server over HTTP for claude.ai's connectors ([claude-ai.md](claude-ai.md)), started with `sh scripts/start.sh mcp`: no volume, one replica (authorization codes are held in its memory), a `/health` check, `PAD_TOKEN` read from `web` (`${{web.PAD_TOKEN}}`), `PAD_URL` at `web`'s public domain, and `PAD_OAUTH_SECRET` via `preserve()`. It calls `web` through the public domain rather than the private network: that works in every Railway environment (older ones route only IPv6 privately, and the server binds IPv4), for a few KB of egress per tool call.

```sh
bun install --cwd .railway                       # once, to fetch the DSL package
railway link                                     # or `railway init -n scratchpad` for a new project
railway config plan                              # read-only: exactly what would change
railway config apply                             # changes the live project — confirm first

TOKEN=$(openssl rand -hex 32); echo "$TOKEN"     # first deploy only; keep it, it's your login
railway variables --service web --set "PAD_TOKEN=$TOKEN"
railway domain --service web
pad login https://<domain> "$TOKEN"              # CLI, MCP and hook now use Railway

# claude.ai's connectors (the mcp service), once:
railway variables --service mcp --set "PAD_OAUTH_SECRET=$(openssl rand -hex 32)"
railway domain --service mcp                     # then add https://<that domain>/mcp in Claude
```

`railway config plan` never changes anything. `railway config apply` does, so read the plan first.

Schema changes ship with the code: named migrations run on startup (see [architecture.md](architecture.md#storage-and-migrations)).
