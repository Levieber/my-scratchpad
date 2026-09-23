# Scratchpad

An API-first scratchpad shared by you and your AI agents. One HTTP API is the source of truth; the React PWA, the `pad` CLI and the Claude Code MCP server are thin clients of it, so people and agents read and write the same notes with the same ease.

```
                ┌──────────── Bun server (src/server.ts) ────────────┐
 PWA (React) ──▶│ /api/notes …   /openapi.json   /llms.txt           │──▶ SQLite + FTS5
 pad CLI ──────▶│ Bearer token (required when public)                │    (local file or
 MCP (Claude) ─▶│ X-Pad-Author → every note records who wrote it     │     Railway volume)
 curl / agents ▶└────────────────────────────────────────────────────┘
```

**Stack:** Bun (runtime, bundler, tests, `bun:sqlite`), React 19, MCP TypeScript SDK; oxlint, oxfmt and knip.

```sh
bun install
bun run dev        # http://127.0.0.1:7777 with HMR
bun test           # API, migrations and architecture tests
bun run lint       # oxlint + oxfmt + knip
bun run typecheck
```

```sh
pad add "idea: …" --tag ideas        # or: echo … | pad add
pad ls [query] [--tag x] [--json]
pad show <id> · pad append <id> "…" · pad edit <id> · pad set <id> --pin · pad rm <id>
pad status · pad login <url> <token> · pad logout
```

API summary for agents: `GET /llms.txt`; full contract: `GET /openapi.json`.

## Docs

- [docs/architecture.md](docs/architecture.md) — the API-first rule and how it's enforced, routes, error codes, migrations, tooling.
- [docs/deployment.md](docs/deployment.md) — configuration, running, Railway (IaC + Railpack).
- [docs/claude-code.md](docs/claude-code.md) — `bun run setup:claude` and what it installs.
