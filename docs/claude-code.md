# Claude Code integration

```sh
bun run setup:claude                  # --no-service: skip the local server · --uninstall: remove it all
```

Run it from the main checkout: it records the paths of the folder it runs in. It is idempotent and backs up `~/.claude/settings.json` to `settings.json.bak-scratchpad`. It installs, at user scope:

- **MCP server** `scratchpad` (`src/mcp.ts`) → tools `scratchpad_search|get|create|append|update|history|diff|delete`, attributed as `claude-code`.
- **Skill** `~/.claude/skills/scratchpad` → symlink to `integrations/claude-code/skill/`: when to use the scratchpad, kinds, tagging and logging conventions.
- **Skill** `~/.claude/skills/pad-review` → symlink to `integrations/claude-code/review-skill/`: how to check edits against reference notes (also `/pad-review` by hand).
- **SessionStart hook** (`pad hook session-start`) → injects the titles of the notes you selected (by default the 8 most recently changed that aren't references) into every session; silent and ~25 ms when the server is unreachable.
- **Review hooks** → reference notes load on demand, not at session start. `pad hook record-edit` (PostToolUse on Edit/Write/MultiEdit/NotebookEdit) records edited paths in `~/.cache/scratchpad/edits/<session>.txt`; `pad hook review` (Stop) then blocks the turn once, listing those files and the reference notes' titles, and Claude follows `pad-review`. It stays silent when nothing was edited, on the turn that answers the review, when the server is unreachable, or with `PAD_REVIEW=off`. The hooks live in `hooks.ts` and the review's wording in `review.ts`; which settings entries are ours, in `settings.ts`.
- **Permissions** → the non-destructive MCP tools and read-only `pad` commands run without prompts; delete still asks.
- **`~/.claude/CLAUDE.md`** → a managed block (`integrations/claude-code/CLAUDE.snippet.md`) between `<!-- scratchpad:start/end -->` markers.
- **`pad`** on the PATH (`~/.local/bin/pad` → `dist/pad`, built by `bun run build:pad`) and, unless `--no-service`, a `scratchpad.service` systemd user unit on `127.0.0.1:7777`.

## Choosing the notes the hooks use

Each hook that reads notes takes a search, in the language of the search box (`kind:x author:x #tag words`, see [architecture](architecture.md)):

```sh
pad hooks                              # what each hook uses now (and which are the defaults)
pad hooks set session-start '#pinned'  # sessions open with the notes tagged #pinned
pad hooks set review kind:reference '#code' '#web'   # review only against these references
pad hooks reset [session-start|review] # back to the defaults
```

| Hook            | Default          | Shows                                        |
| --------------- | ---------------- | -------------------------------------------- |
| `session-start` | `kind:note`      | up to 8 matches, most recently changed first |
| `review`        | `kind:reference` | up to 100 matches, titles Claude picks from  |

`pad hooks set` prints the notes the query selects, so a choice shows what it does; one that matches nothing makes the hook add nothing. Selecting by tag is the usual way to pick notes: tag the ones you want (`#pinned`) and every machine's hooks follow, since only the query is stored locally, in `~/.config/scratchpad/hooks.json` (beside `config.json`, but never touched by `pad login` or `logout`). When you choose the session notes, the context stops saying that reference notes are left out, since your query may include them.

## `pad` is compiled

The hooks run on every session, edit and turn, so `pad` and the hooks are one executable: `bun run build:pad` compiles `src/cli.ts` with bytecode into `dist/pad` (~86 MB, Bun's runtime included), and the hooks are its `pad hook <name>` commands. A hook or `pad` run takes ~25 ms that way, against ~100 ms from source (see [effect.md](effect.md)). The PWA and the files `pad serve` needs are inside it too; `test/binary.test.ts` builds it and checks that.

The executable doesn't follow the source: **after changing or pulling code, run `bun run build:pad`** (the `~/.local/bin/pad` link picks the new one up), or `pad` and the hooks keep running the old code. `bun src/cli.ts …` always runs the source. The MCP server and the systemd service run from source, so they start once and need no rebuild.

The Stop hook fires at the end of every turn, not every task, so a long session gets one review per turn that edited files. Set `PAD_REVIEW=off` in the environment Claude Code starts from to disable it.

The MCP server, CLI and hooks all read the same client config, so `pad login <url> <token>` switches all three between the local server and Railway with no reinstall.

Inside Claude Code shells, `pad` writes are attributed to `claude-code` automatically (Claude Code sets `CLAUDECODE=1`); `PAD_AUTHOR` overrides.
