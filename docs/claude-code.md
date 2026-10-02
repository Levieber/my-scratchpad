# Claude Code integration

```sh
bun run setup:claude                  # --no-service: skip the local server · --uninstall: remove it all
```

Run it from the main checkout: it records the paths of the folder it runs in. It is idempotent and backs up `~/.claude/settings.json` to `settings.json.bak-scratchpad`. It installs, at user scope:

- **MCP server** `scratchpad` (`src/mcp.ts`) → tools `scratchpad_search|get|create|append|update|history|diff|delete`, attributed as `claude-code`.
- **Skill** `~/.claude/skills/scratchpad` → symlink to `integrations/claude-code/skill/`: when to use the scratchpad, kinds, tagging and logging conventions.
- **Skill** `~/.claude/skills/pad-review` → symlink to `integrations/claude-code/review-skill/`: how to check edits against reference notes (also `/pad-review` by hand).
- **SessionStart hook** (`integrations/claude-code/session-start.ts`) → injects recent note titles into every session; silent and ~20 ms when the server is unreachable.
- **Review hooks** → reference notes load on demand, not at session start. `record-edit.ts` (PostToolUse on Edit/Write/MultiEdit/NotebookEdit) records edited paths in `~/.cache/scratchpad/edits/<session>.txt`; `review-hook.ts` (Stop) then blocks the turn once, listing those files and the reference notes' titles, and Claude follows `pad-review`. It stays silent when nothing was edited, on the turn that answers the review, when the server is unreachable, or with `PAD_REVIEW=off`. The logic lives in `review.ts`; which settings entries are ours, in `settings.ts`.
- **Permissions** → the non-destructive MCP tools and read-only `pad` commands run without prompts; delete still asks.
- **`~/.claude/CLAUDE.md`** → a managed block (`integrations/claude-code/CLAUDE.snippet.md`) between `<!-- scratchpad:start/end -->` markers.
- **`pad`** on the PATH (`~/.local/bin/pad` → `src/cli.ts`) and, unless `--no-service`, a `scratchpad.service` systemd user unit on `127.0.0.1:7777`.

The Stop hook fires at the end of every turn, not every task, so a long session gets one review per turn that edited files. Set `PAD_REVIEW=off` in the environment Claude Code starts from to disable it.

The MCP server, CLI and hooks all read the same client config, so `pad login <url> <token>` switches all three between the local server and Railway with no reinstall.

Inside Claude Code shells, `pad` writes are attributed to `claude-code` automatically (Claude Code sets `CLAUDECODE=1`); `PAD_AUTHOR` overrides.
