# Scratchpad

API-first scratchpad shared by a person and their agents. Bun, React 19, SQLite (FTS5), MCP. The PWA is styled with Tailwind v4 utilities and shadcn components (Base UI): see "Styling the PWA" in `docs/architecture.md`.

## Commands

```bash
bun run dev          # server + PWA with HMR on :7777
bun test             # API, migrations and architecture tests
bun run lint         # oxlint + oxfmt + knip   (bun run lint:fix to fix)
bun run typecheck
bun run setup:claude # user-scope Claude Code wiring (integrations/claude-code/)
bun run build:pad    # recompile dist/pad (= ~/.local/bin/pad and the hooks) after changing code
bun run build:icons  # re-render the PWA icons (public/*.png) from the SVGs; needs Chrome
```

Use Bun for everything: `bun`, `bun test`, `bun install`, `bunx`. No Node, npm, Jest, Vite, dotenv, express or better-sqlite3.

## Rules that apply to every change

- The HTTP API is the only way in: clients never import anything under `src/server/` at runtime. New capabilities land in the API first (route, `server/docs/openapi.ts`, test), then in the clients. `test/architecture.test.ts` enforces the boundaries.
- API errors are `{ error: <code from src/shared/errors.ts>, message }`. Add a code rather than inventing a string.
- Schema changes append a migration to `src/server/storage/migrations.ts`. Never edit one that has shipped.
- Import by alias, never `../`: `@/` is `src/`, `@integrations/` is `integrations/`, `@test/` is `test/`; `./` only for a sibling in the same folder. Effect modules by path (`effect/Effect`, not `effect`). Both are checked by `test/architecture.test.ts`.
- Comments explain a decision; don't narrate the code.
- Never `git push` or open a PR unless the user asks — pushing `main` deploys to Railway.

## Skills

Area-specific guidance lives in project skills (`.claude/skills/`). Each condenses a document in `docs/`; when a change alters what a skill says, update both.

| Skill          | Use it when                                                                                                   | Source document                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `architecture` | adding endpoints/commands/tools, errors, migrations, writing Effect code, lint, a boundary fails, PWA styling | `docs/architecture.md`, `docs/effect.md`, `docs/design-system.md` |
| `deployment`   | env vars, config, start/build scripts, Railway                                                                | `docs/deployment.md`                                              |

The Claude Code integration itself is described in `docs/claude-code.md`. `README.md` is a short index for people; put detail in `docs/`.

## Vendored Repositories

This project vendors external repositories under @repos/

- Use vendored repositories as read-only reference material when working with related libraries
- Prefer examples and patterns from the vendored source code over generated guesses or web search results
- Do not edit files under @repos/ unless explicitly asked
- Do not import from @repos/ - application code should continue importing from normal package dependencies

When writing Effect code, inspect @repos/effect/ for examples of idiomatic usage, tests, module structure, and API design. Treat it as the source of truth for Effect patterns.
