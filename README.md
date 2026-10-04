# Scratchpad

An API-first scratchpad shared by you and your AI agents. One HTTP API is the source of truth; the React PWA, the `pad` CLI and the Claude Code MCP server are thin clients of it, so people and agents read and write the same notes with the same ease. Every change is kept with its author and can be diffed or restored, and the PWA keeps working offline, merging its edits when it reconnects.

```
                ┌──────────── Bun server (src/server.ts) ────────────┐
 PWA (React) ──▶│ /api/notes …   /openapi.json   /llms.txt           │──▶ SQLite + FTS5
 pad CLI ──────▶│ Bearer token (required when public)                │    (local file or
 MCP (Claude) ─▶│ X-Pad-Author → every note records who wrote it     │     Railway volume)
 curl / agents ▶└────────────────────────────────────────────────────┘
```

**Stack:** Bun (runtime, bundler, tests, SQLite), Effect 4 (HTTP server and client, SQL, config, CLI, MCP server), React 19 for the PWA; oxlint, oxfmt and knip.

```sh
bun install
bun run dev        # http://127.0.0.1:7777 with HMR
bun test           # API, migrations and architecture tests
bun run lint       # oxlint + oxfmt + knip
bun run typecheck
bun run build:pad  # compile `pad` (and the Claude Code hooks) after changing code
```

```sh
pad add "idea: …" --tag ideas        # or: echo … | pad add
pad ls [query] [--tag x]... [--kind reference] [--author agent] [--json]   # query: words, kind:reference, author:agent, '#tag', @view
pad history <id> · pad diff <id> [--since <time>]   # who changed a note, and what
pad show <id> · pad append <id> "…" · pad edit <id> · pad set <id> --kind reference · pad rm <id>
pad export [file] [--tag x] [--kind k] [--no-history] · pad import [file]   # an archive as JSON: notes with their history, views, pins; import skips ids that already exist
pad status · pad login <url> <token> · pad logout
```

API summary for agents: `GET /llms.txt`; full contract: `GET /openapi.json`.

## Docs

- [docs/self-hosting.md](docs/self-hosting.md) — run it on your machine, a server or Railway, and connect clients.
- [docs/architecture.md](docs/architecture.md) — the API-first rule and how it's enforced, routes, error codes, migrations, tooling.
- [docs/deployment.md](docs/deployment.md) — configuration, running, Railway (IaC + Railpack).
- [docs/export-format.md](docs/export-format.md) — the export archive: its format, versions and what an import does with it.
- [docs/effect.md](docs/effect.md) — why everything but the PWA is written with Effect, the decisions behind it, and what it cost.
- [docs/claude-code.md](docs/claude-code.md) — `bun run setup:claude` and what it installs.

## Contributing and license

See [CONTRIBUTING.md](CONTRIBUTING.md). Released under the [MIT License](LICENSE).
