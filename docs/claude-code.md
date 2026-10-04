# Claude Code integration

```sh
bun run setup:claude                  # --no-service: skip the local server · --uninstall: remove it all
```

Run it from the main checkout: it records the paths of the folder it runs in. It is idempotent and backs up `~/.claude/settings.json` to `settings.json.bak-scratchpad`. It installs, at user scope:

- **MCP server** `scratchpad` (`src/mcp.ts`) → tools `scratchpad_search|get|create|append|update|history|diff|delete`, attributed as `claude-code`, and `scratchpad_hooks`, read-only: what the hooks show where Claude works, and why.
- **Skill** `~/.claude/skills/scratchpad` → symlink to `integrations/claude-code/skill/`: when to use the scratchpad, kinds, tagging and logging conventions.
- **Skill** `~/.claude/skills/pad-review` → symlink to `integrations/claude-code/review-skill/`: how to check edits against reference notes (also `/pad-review` by hand).
- **SessionStart hook** (`pad hook session-start`) → injects the titles of the notes chosen for where the session works (by default the 8 most recently changed that aren't references, plus whatever you chose for that repository or folder); silent and fast when the server is unreachable.
- **Review hooks** → reference notes load on demand, not at session start. `pad hook record-edit` (PostToolUse on Edit/Write/MultiEdit/NotebookEdit) records edited paths in `~/.cache/scratchpad/edits/<session>.txt`; `pad hook review` (Stop) then blocks the turn once, listing those files and the reference notes' titles, and Claude follows `pad-review`. It stays silent when nothing was edited, on the turn that answers the review, when the server is unreachable, or with `PAD_REVIEW=off`. The hooks live in `hooks.ts` and the review's wording in `review.ts`; which settings entries are ours, in `settings.ts`.
- **Permissions** → the non-destructive MCP tools and read-only `pad` commands run without prompts; delete still asks.
- **`~/.claude/CLAUDE.md`** → a managed block (`integrations/claude-code/CLAUDE.snippet.md`) between `<!-- scratchpad:start/end -->` markers.
- **`pad`** on the PATH (`~/.local/bin/pad` → `dist/pad`, built by `bun run build:pad`) and, unless `--no-service`, a `scratchpad.service` systemd user unit on `127.0.0.1:7777`.

## Choosing the notes the hooks use

Each hook that reads notes shows a **selection**: a search in the language of the search box (`kind:x author:x #tag words`, see [architecture](architecture.md)), notes you **hand-picked** (listed first, never cut by the limit), and a limit. Selections are kept on the server (`/api/hooks`), so every machine, the PWA and agents see the same ones, and they apply to a **scope**. Choose them with `pad hooks` (below) or in the PWA: **Settings → Agents** (`/settings`) edits every scope and previews what agents see, and a note's menu has "Show at session start" (and, for references, "Use in reviews") to hand-pick it for everywhere.

| Scope                    | Applies                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| _(empty)_                | everywhere                                                                                                                      |
| `my-scratchpad`          | in that repository, named by its `origin` remote (else its folder), so the same on every machine and in every clone or worktree |
| `my-scratchpad/apps/web` | in that folder of the repository, and below                                                                                     |
| `/home/me/work`          | in that folder and every folder below it, repositories included: one choice for all the projects it holds (one machine's path)  |

Where Claude works, a hook shows every selection that applies: the closest to that folder first (a repository is narrower than a folder holding it, a folder inside the repository narrower still), then the one for everywhere (or the default), each as its own section, no note twice.

```sh
pad hooks                                        # each hook's default, the stored choices, this machine's own search
pad hooks set session-start '#pinned'            # everywhere: sessions open with the notes tagged #pinned
pad hooks set session-start '#pad' --here        # in this repository, those notes too
pad hooks set review kind:reference '#web' --scope my-app/web --limit 20
pad hooks include session-start <note-id> [--here|--scope x]   # hand-pick a note; exclude to stop
pad hooks preview [session-start|review]         # what the hooks show an agent working in this folder
pad hooks reset [hook] [--here|--scope x]        # back to the default there
```

| Hook            | Default          | Shows                                          |
| --------------- | ---------------- | ---------------------------------------------- |
| `session-start` | `kind:note`      | up to 8 notes, most recently changed first     |
| `review`        | `kind:reference` | up to 100 references, titles Claude picks from |

`pad hooks set` prints the notes the selection picks, so a choice shows what it does; one that matches nothing makes the hook add nothing. When any selection applies to the session, the context stops saying that reference notes are left out, since your choice may include them.

**This machine's own search.** `pad hooks set <hook> <query> --local` keeps a search in `~/.config/scratchpad/hooks.json` (beside `config.json`, never touched by `pad login` or `logout`) that replaces the search for everywhere on this machine only: for a work laptop that should differ. `pad hooks reset --local` drops it; `pad hooks push` makes it the choice for every machine. Against a server older than hook selections, the hooks fall back to this search, or to the default, as they worked before.

## `pad` is compiled

The hooks run on every session, edit and turn, so `pad` and the hooks are one executable: `bun run build:pad` compiles `src/cli.ts` with bytecode into `dist/pad` (~86 MB, Bun's runtime included), and the hooks are its `pad hook <name>` commands. A hook or `pad` run takes ~25 ms that way, against ~100 ms from source (see [effect.md](effect.md)). The PWA and the files `pad serve` needs are inside it too; `test/binary.test.ts` builds it and checks that.

The executable doesn't follow the source: **after changing or pulling code, run `bun run build:pad`** (the `~/.local/bin/pad` link picks the new one up), or `pad` and the hooks keep running the old code. `bun src/cli.ts …` always runs the source. The MCP server and the systemd service run from source, so they start once and need no rebuild.

The Stop hook fires at the end of every turn, not every task, so a long session gets one review per turn that edited files. Set `PAD_REVIEW=off` in the environment Claude Code starts from to disable it.

The MCP server, CLI and hooks all read the same client config, so `pad login <url> <token>` switches all three between the local server and Railway with no reinstall.

Inside Claude Code shells, `pad` writes are attributed to `claude-code` automatically (Claude Code sets `CLAUDECODE=1`); `PAD_AUTHOR` overrides.
