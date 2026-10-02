# Configuration and deployment

## Configuration

Every variable is read in `src/config.ts`, as Effect `Config`: a value that is set but malformed (`PAD_PORT=abc`) stops startup with the reason instead of being used, an empty one counts as unset, and tokens are `Redacted`, so they never show in a log.

| Var                 | Default                            |                                                                   |
| ------------------- | ---------------------------------- | ----------------------------------------------------------------- |
| `PAD_PORT` / `PORT` | 7777                               | `PORT` (set by Railway) also switches the bind host to `0.0.0.0`  |
| `PAD_HOST`          | 127.0.0.1                          |                                                                   |
| `PAD_DB`            | `~/.local/share/scratchpad/pad.db` | `/data/pad.db` on Railway                                         |
| `PAD_TOKEN`         | –                                  | server: required when not on loopback; clients: the token to send |
| `PAD_URL`           | from `pad login`, else local       | clients only                                                      |
| `PAD_AUTHOR`        | `human` / `claude-code`            | attribution on writes                                             |
| `NODE_ENV`          | –                                  | `production` disables HMR; the PWA is bundled once at startup     |

Clients (CLI, MCP server, SessionStart hook) prefer `pad login <url> <token>`, which writes `~/.config/scratchpad/config.json` (mode 600). Env vars override it.

## Running

- `bun run dev` — HMR, and browser console output streamed to the terminal.
- `bun run start` — `NODE_ENV=production bun src/server.ts`. There is no server build: Bun bundles the PWA from the HTML import at startup (well under a second). SIGINT/SIGTERM (a Railway redeploy) shut it down gracefully: requests are interrupted and the database is closed.
- `bun run build` — optional: bundle the PWA into `dist/` to inspect its output and size. Nothing serves `dist/`.

## Railway

Infrastructure as Code in `.railway/railway.ts`; `.railway/package.json` pins the `railway/iac` DSL and `.railway/` is its own mini-project (own tsconfig, ignored by the root tsconfig and knip). Don't add `railway.json`/`railway.toml` — config-as-code is deprecated and stops being read on 2026-12-01 — and don't add a `Dockerfile`: Railpack builds the app and picks Bun up from `bun.lock`.

It declares one `web` service deployed from `github.com/Levieber/my-scratchpad` on every push to `main`, started with `bun run start`, with:

- a 1 GB volume at `/data` holding the SQLite file — that volume _is_ the database, so exactly one replica;
- a `/api/health` healthcheck;
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
