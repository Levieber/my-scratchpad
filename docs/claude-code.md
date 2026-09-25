# Claude Code integration

```sh
bun run setup:claude                  # --no-service: skip the local server · --uninstall: remove it all
```

Run it from the main checkout: it records the paths of the folder it runs in. It is idempotent and backs up `~/.claude/settings.json` to `settings.json.bak-scratchpad`. It installs, at user scope:

- **MCP server** `scratchpad` (`src/mcp.ts`) → tools `scratchpad_search|get|create|append|update|daily|delete`, attributed as `claude-code`.
- **Skill** `~/.claude/skills/scratchpad` → symlink to `integrations/claude-code/skill/`: when to use the scratchpad, tagging and logging conventions.
- **SessionStart hook** (`integrations/claude-code/session-start.ts`) → injects pinned notes and recent titles into every session; silent and ~20 ms when the server is unreachable.
- **Permissions** → the non-destructive MCP tools and read-only `pad` commands run without prompts; delete still asks.
- **`~/.claude/CLAUDE.md`** → a managed block (`integrations/claude-code/CLAUDE.snippet.md`) between `<!-- scratchpad:start/end -->` markers.
- **`pad`** on the PATH (`~/.local/bin/pad` → `src/cli.ts`) and, unless `--no-service`, a `scratchpad.service` systemd user unit on `127.0.0.1:7777`.

The MCP server, CLI and hook all read the same client config, so `pad login <url> <token>` switches all three between the local server and Railway with no reinstall.

Inside Claude Code shells, `pad` writes are attributed to `claude-code` automatically (Claude Code sets `CLAUDECODE=1`); `PAD_AUTHOR` overrides.
