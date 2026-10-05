---
name: scratchpad
description: The user's personal scratchpad (notes shared between the user and AI agents). Use when the user says "remember", "note this", "jot down", "save to my scratchpad/pad/notes", asks what they wrote about something, refers to a note, TODO or idea they saved earlier, or when a long task deserves a progress log. Also use to look up context before asking the user to repeat themselves.
---

# Scratchpad

An API-first scratchpad the user reads and writes from a PWA and the `pad` CLI; you use the same API.

## How to access it (in order of preference)

1. **MCP tools** `scratchpad_search`, `scratchpad_get`, `scratchpad_create`, `scratchpad_append`, `scratchpad_update`, `scratchpad_history`, `scratchpad_diff`, `scratchpad_delete`; `scratchpad_views` lists the user's saved searches (pass a view's `query` to `scratchpad_search`) and `scratchpad_save_view` saves one, only when the user asks.
2. **CLI** via Bash when MCP is unavailable: `pad ls [query] --json`, `pad show <id> --json`, `pad add "text" --tag x`, `echo "text" | pad append <id>`, `pad set <id> --kind reference`. Writes from Claude Code are attributed as `claude-code` automatically.
3. **HTTP** as a last resort: see `pad status` for the base URL, `GET <url>/llms.txt` for the API summary.

## Conventions

- **Search before creating.** If a relevant note exists, `append` or `update` it instead of making a duplicate.
- **Titles:** short and specific. The first line of the body becomes the title if you omit one.
- **Tags:** lowercase, kebab-case. Use the project/repo name as a tag for project notes (e.g. `my-scratchpad`), plus a type when useful: `todo`, `idea`, `decision`, `log`, `snippet`.
- **Kinds:** `note` (default) for anything used once or finished: to-dos, learnings, logs. `reference` for reusable rules to check work against: best practices, principles, checklists. A use case is a tag, not a kind: a launch checklist is `reference` + `#checklist #launch`. Search with operators: `kind:reference #launch`, `author:human` / `author:agent` (who created it); `scratchpad_search` also takes `author`.
- **Links:** write `[[Note title]]` (or `[[id]]`) in a body to link another note; the user follows it in the PWA, and `GET /api/notes/{id}/backlinks` lists the notes linking to one.
- **Embedded views:** a fenced block ` ```pad-view ` with `query: #todo` (or `view: <saved view's name>`), and optionally `layout: grid` and `limit: 10`, shows that search's notes live inside a note in the PWA; elsewhere it reads as code. Useful for a dashboard page the user asks for.
- **Pages:** notes nest. A note's `parent_id` is the page it is under (`subpages` counts what is under it). When the user keeps a page for a project or topic, file related notes under it (`parent_id` on `scratchpad_create`, `pad add … --parent <id>`) rather than leaving them loose; `scratchpad_search` with `parent` lists a page's notes (`pad ls --parent <id>`).
- **Logs:** for multi-step work, create one note tagged `log` and `append` timestamped lines (`2026-09-23 14:02 — migrated schema`) rather than creating many notes.
- **History:** every change is kept. Before reworking a note you touched earlier, `scratchpad_diff` with `since` = the `updated_at` you last saw shows what the user changed meanwhile (`pad diff <id> --since …`); `scratchpad_history` lists who changed it when.
- **Never delete** unless the user explicitly asks. Never store secrets (API keys, passwords, tokens) in notes.
- Mention the note id/title when you save something so the user can find it.

## If the server is unreachable

Tell the user and suggest `pad status`; locally it runs as `systemctl --user start scratchpad`, and a deployed instance is selected with `pad login <url> <token>`.
