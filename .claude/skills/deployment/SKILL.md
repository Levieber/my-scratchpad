---
name: deployment
description: Configuration, environment variables and Railway for my-scratchpad. Use when touching src/config/, .railway/railway.ts, package.json start/build scripts, the /data volume, PAD_TOKEN, or anything about deploying, Railpack or `pad login`.
---

# Deployment

The detail is in `docs/deployment.md`. Update it in the same change when something here moves.

- Every env var is read in `src/config/` (`server.ts`, `client.ts`, `hooks.ts`; `env.ts` has what they share) (`PAD_PORT`/`PORT`, `PAD_HOST`, `PAD_DB`, `PAD_TOKEN`, `PAD_MAX_IMPORT_BYTES`, `PAD_URL`, `PAD_AUTHOR`, `NODE_ENV`). Add new ones there (as Effect `Config`; wrap optional ones in `Config.option`, so a malformed value fails rather than falling through to a default) and to the table in the doc and `.env.example`.
- Production runs `bun run start` = `NODE_ENV=production bun src/server.ts`. At start, in production, the server builds the PWA with `scripts/build.ts web` in a child process and serves `dist/web` from disk (`src/server/pwa-build.ts`); without a source tree it falls back to Bun bundling the HTML import on the first request, which keeps ~80 MB in the process. Polled collections (list, tags, views, pins) answer 304 to `If-None-Match` (`polled` in `src/server/http.ts`); the numbers are in `docs/deployment.md`.

## Railway

- Infrastructure as Code in `.railway/railway.ts`; `.railway/package.json` pins the DSL. Don't add `railway.json`/`railway.toml` (deprecated, stop being read on 2026-12-01) or a `Dockerfile` — Railpack builds from `bun.lock`.
- Pushing `main` deploys (`source: github(...)`). **Never push unless the user asks.**
- The 1 GB volume at `/data` is the whole database: one replica only. `PAD_TOKEN` uses `preserve()` and never goes in the repo.
- `railway config plan` changes nothing. `railway config apply` changes the live project: show the user the plan and get their confirmation before running it.
- Typecheck the IaC with `node_modules/.bin/tsc -p .railway` after editing it.
