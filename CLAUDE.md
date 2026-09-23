# Scratchpad

API-first scratchpad shared by a person and their agents. Bun, React 19, SQLite (FTS5), MCP.

## Commands

```bash
bun run dev          # server + PWA with HMR on :7777
bun test             # API, migrations and architecture tests
bun run lint         # oxlint + oxfmt + knip   (bun run lint:fix to fix)
bun run typecheck
bun run setup:claude # user-scope Claude Code wiring (integrations/claude-code/)
```

Use Bun for everything: `bun`, `bun test`, `bun install`, `bunx`. No Node, npm, Jest, Vite, dotenv, express or better-sqlite3.

## Rules that apply to every change

- The HTTP API is the only way in: clients never import `db.ts`, `migrations.ts` or `server.ts` at runtime. New capabilities land in the API first (route, `openapi.ts`, test), then in the clients. `test/architecture.test.ts` enforces the boundaries.
- API errors are `{ error: <code from src/errors.ts>, message }`. Add a code rather than inventing a string.
- Schema changes append a migration to `src/migrations.ts`. Never edit one that has shipped.
- Comments explain a decision; don't narrate the code.
- Never `git push` or open a PR unless the user asks — pushing `main` deploys to Railway.

## Skills

Area-specific guidance lives in project skills (`.claude/skills/`). Each condenses a document in `docs/`; when a change alters what a skill says, update both.

| Skill          | Use it when                                                                 | Source document        |
| -------------- | --------------------------------------------------------------------------- | ---------------------- |
| `architecture` | adding endpoints/commands/tools, errors, migrations, lint, a boundary fails | `docs/architecture.md` |
| `deployment`   | env vars, config, start/build scripts, Railway                              | `docs/deployment.md`   |

The Claude Code integration itself is described in `docs/claude-code.md`. `README.md` is a short index for people; put detail in `docs/`.
