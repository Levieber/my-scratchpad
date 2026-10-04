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
| `PAD_AUTHOR`           | `human` / `claude-code`            | attribution on writes                                                    |
| `NODE_ENV`             | –                                  | `production` disables HMR and builds the PWA at start (see below)        |

Clients (CLI, MCP server, SessionStart hook) prefer `pad login <url> <token>`, which writes `~/.config/scratchpad/config.json` (mode 600). Env vars override it.

## Logs

With `NODE_ENV=production` (Railway) the server logs one JSON object per line: a `request` line per request (`requestId`, `method`, `path`, `status`, `durationMs`; no query string, no token) and the cause of every failure, all sharing the `requestId` that is also the response's `x-request-id` header and, when Railway sent one, its `x-railway-request-id`. Find the error behind a 5xx from the platform's access log:

```sh
railway logs --json | jq -c 'select(.annotations.requestId == "<id>")'
railway logs --json | jq -c 'select(.level == "ERROR")'
```

Locally the log stays human-readable.

## Running

- `bun run dev` — HMR, and browser console output streamed to the terminal.
- `bun run start` — `NODE_ENV=production bun src/server.ts`. With `NODE_ENV=production` the server first runs `scripts/build.ts web` in a process of its own (about half a second), then serves `dist/web` from disk: the bundler and Tailwind's compiler (the plugin `bunfig.toml` names) are gone when that process exits instead of staying in the server. It builds at every start, so a pulled change is never served as the old build, and needs nothing from the platform's build step. Where it can't (a compiled `pad`, a tree that can't be written) it logs a warning and Bun bundles on the first request, as before. SIGINT/SIGTERM (a Railway redeploy) shut it down gracefully: requests are interrupted, the database is closed and the process exits 0 (`teardown` in `src/server/serve.ts`). Exiting non-zero on a signal would make the on-failure restart policy report every redeploy as a crash.
- `bun run build` — bundle the PWA into `dist/web` (`scripts/build.ts web`); the server does this itself at start, so run it only to inspect the output and its size.

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

## Railway

Infrastructure as Code in `.railway/railway.ts`; `.railway/package.json` pins the `railway/iac` DSL and `.railway/` is its own mini-project (own tsconfig, ignored by the root tsconfig and knip). Don't add `railway.json`/`railway.toml` — config-as-code is deprecated and stops being read on 2026-12-01 — and don't add a `Dockerfile`: Railpack builds the app and picks Bun up from `bun.lock`.

It declares one `web` service deployed from `github.com/Levieber/my-scratchpad` on every push to `main`, started with `bun run start`, with:

- a 1 GB volume at `/data` holding the SQLite file — that volume _is_ the database, so exactly one replica;
- a `/api/health` healthcheck, which reads the database: a deploy whose volume can't be queried never goes live (see [Observability](architecture.md#observability));
- `PAD_TOKEN` via `preserve()`: set once in Railway, never in the repo. The server refuses to start publicly without it.

```sh
bun install --cwd .railway                       # once, to fetch the DSL package
railway link                                     # or `railway init -n scratchpad` for a new project
railway config plan                              # read-only: exactly what would change
railway config apply                             # changes the live project — confirm first

TOKEN=$(openssl rand -hex 32); echo "$TOKEN"     # first deploy only; keep it, it's your login
railway variables --service web --set "PAD_TOKEN=$TOKEN"
railway domain --service web
pad login https://<domain> "$TOKEN"              # CLI, MCP and hook now use Railway
```

`railway config plan` never changes anything. `railway config apply` does, so read the plan first.

Schema changes ship with the code: named migrations run on startup (see [architecture.md](architecture.md#storage-and-migrations)).
