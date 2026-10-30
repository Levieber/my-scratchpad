---
name: deployment
description: Configuration, environment variables and Railway for my-scratchpad. Use when touching src/config/, .railway/railway.ts, package.json start/build scripts, the /data volume, PAD_TOKEN, or anything about deploying, the Dockerfile or `pad login`.
---

# Deployment

The detail is in `docs/deployment.md`. Update it in the same change when something here moves.

- Every env var is read in `src/config/` (`server.ts`, `client.ts`, `hooks.ts`; `env.ts` has what they share) (`PAD_PORT`/`PORT`, `PAD_HOST`, `PAD_DB`, `PAD_TOKEN`, `PAD_MAX_IMPORT_BYTES`, `PAD_URL`, `PAD_AUTHOR`, `NODE_ENV`; for the MCP server over HTTP, `mcp-http.ts`: `PAD_MCP_PORT`, `PAD_MCP_URL`, `PAD_OAUTH_SECRET`). Add new ones there (as Effect `Config`; wrap optional ones in `Config.option`, so a malformed value fails rather than falling through to a default) and to the table in the doc and `.env.example`.
- From a clone, production runs `sh scripts/start.sh server` (= `bun run start`; the systemd unit calls the script itself, since `bun run` would stay resident beside the server, ~10 MB): it builds `dist/pad-server`, one executable with bytecode and the PWA in chunks inside it (`scripts/builds.ts`), and `exec`s it; ~10 MB less than from source. A failed build falls back to `bun src/server.ts`, which in production builds the PWA into `dist/web` in a child process and serves it from disk (`src/server/pwa-build.ts`); never let Bun bundle the HTML import in the server process, which keeps ~80 MB. The page prefetches its lazy chunks (`builtFiles` in `src/server/pages.ts`) so the service worker has them offline. Polled collections (list, tags, views, pins) answer 304 to `If-None-Match` (`polled` in `src/server/http.ts`); the numbers are in `docs/deployment.md`.

## Railway

- Infrastructure as Code in `.railway/railway.ts`; `.railway/package.json` pins the DSL. Don't add `railway.json`/`railway.toml` (deprecated, stop being read on 2026-12-01) Both services build from the `Dockerfile` (multi-stage: Bun pinned there compiles `dist/pad-server` and `dist/pad-mcp`; the image keeps only them) and start `/app/pad-server` / `/app/pad-mcp`; never let the running container compile or carry the source.
- Pushing `main` deploys (`source: github(...)`). **Never push unless the user asks.**
- The 1 GB volume at `/data` is the whole database: one replica only. `PAD_TOKEN` uses `preserve()` and never goes in the repo.
- A second service, `mcp`, runs the same image's `/app/pad-mcp` (MCP over HTTP for claude.ai's connectors, `docs/claude-ai.md`): no volume, one replica (authorization codes live in memory), `PAD_TOKEN` referenced from `web`, `PAD_URL` at `web`'s public domain, `PAD_OAUTH_SECRET` via `preserve()`.
- `railway config plan` changes nothing. `railway config apply` changes the live project: show the user the plan and get their confirmation before running it.
- Typecheck the IaC with `node_modules/.bin/tsc -p .railway` after editing it.
