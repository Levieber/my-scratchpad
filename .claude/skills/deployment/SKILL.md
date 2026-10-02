---
name: deployment
description: Configuration, environment variables and Railway for my-scratchpad. Use when touching src/config.ts, .railway/railway.ts, package.json start/build scripts, the /data volume, PAD_TOKEN, or anything about deploying, Railpack or `pad login`.
---

# Deployment

The detail is in `docs/deployment.md`. Update it in the same change when something here moves.

- Every env var is read in `src/config.ts` (`PAD_PORT`/`PORT`, `PAD_HOST`, `PAD_DB`, `PAD_TOKEN`, `PAD_URL`, `PAD_AUTHOR`, `NODE_ENV`). Add new ones there (as Effect `Config`; wrap optional ones in `Config.option`, so a malformed value fails rather than falling through to a default) and to the table in the doc and `.env.example`.
- Production runs `bun run start` = `NODE_ENV=production bun src/server.ts`. No server build; Bun bundles the PWA from the HTML import at startup. `bun run build` only produces an inspectable PWA bundle in `dist/`.

## Railway

- Infrastructure as Code in `.railway/railway.ts`; `.railway/package.json` pins the DSL. Don't add `railway.json`/`railway.toml` (deprecated, stop being read on 2026-12-01) or a `Dockerfile` — Railpack builds from `bun.lock`.
- Pushing `main` deploys (`source: github(...)`). **Never push unless the user asks.**
- The 1 GB volume at `/data` is the whole database: one replica only. `PAD_TOKEN` uses `preserve()` and never goes in the repo.
- `railway config plan` changes nothing. `railway config apply` changes the live project: show the user the plan and get their confirmation before running it.
- Typecheck the IaC with `node_modules/.bin/tsc -p .railway` after editing it.
