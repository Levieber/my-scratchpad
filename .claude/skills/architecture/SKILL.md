---
name: architecture
description: How my-scratchpad is structured and the API-first rule. Use before adding an endpoint, a CLI command, an MCP tool or a PWA feature; when touching anything in src/server/ (routes, storage, migrations), src/shared/domain.ts or src/shared/errors.ts; when writing Effect code here; when changing lint config; or when test/architecture.test.ts fails.
---

# Architecture

The reasoning is in `docs/architecture.md`, and for Effect in `docs/effect.md`. Update them in the same change when a rule here moves.

## The rule

The HTTP API is the only way in. Each folder of `src/` is one responsibility: `shared/` (pure, used by everyone, imports no process), `server/` (the API; `server/storage/` is the only code that touches SQLite), `client/`, `config/`, `cli/`, `mcp/`, `web/`. Clients (`web/`, `cli.ts` + `cli/`, `mcp.ts` + `mcp/`, `client/`, `integrations/`) never import `server/` at runtime (type-only imports are fine). `web/` imports no `bun`/`node:` modules, not `config/`/`client/`, and no Effect. Storage imports nothing else of `server/`. The three entry points (`src/server.ts`, `cli.ts`, `mcp.ts`) stay at the root: installed units and registrations name them. `test/architecture.test.ts` enforces all of it.

## Imports

- Never `../`: `@/` is `src/`, `@integrations/` is `integrations/`, `@test/` is `test/`; `./` only for a sibling in the same folder.
- Effect by module path: `import * as Effect from "effect/Effect"`, `effect/http/HttpRouter`, `@effect/platform-bun/BunHttpServer`. Never a barrel (`effect`, `effect/http`, …): Bun loads all of it, ~30 ms per `pad`/hook run.
- For Effect idioms, read `repos/effect/` (`LLMS.md`, `ai-docs/`), not the web.

## Adding a capability

1. A shape in `src/shared/domain.ts` (Schema; the type derives from it).
2. Storage in `src/server/storage/`: a method in the file of its area (`notes.ts`, `revisions.ts`, `views.ts`; `store.ts` composes them); a domain outcome is a `Schema.TaggedError` in `errors.ts`, SQL failures stay defects (`run` in `sql.ts`). Check-then-write goes in `sql.withTransaction`.
3. Route in `server/routes.ts` via `resource(path, { GET, POST, … })` (`resource.ts`): it adds the bearer check, `guard`'s error mapping and 405 + `Allow`. Reading a request and answering are helpers in `server/http.ts`. Refuse with `yield* refuse(code, status, detail?)`; map a new store error in `guard` (and the `Failure` type in `http.ts`).
4. Schema in `server/docs/openapi.ts`; mention in `docs/llms.ts` if agents should use it.
5. Test in `test/server/api.test.ts` (`testServer()` from `@test/support`: the real server on port 0; `server.run` reaches the Store and SQL).
6. Then clients: `client/client.ts` (a method on the `Client` service) → a command in `cli/commands/` (`effect/cli`) / a tool in `mcp/tools.ts` with its handler in `mcp/handlers.ts`, and `web/lib/api.ts`.

## PWA components

- Tailwind v4 utilities on the elements; no CSS classes of our own. Colors are the palette tokens (`bg-card`, `text-muted-foreground`, `border-border`, `text-primary`…, in `src/web/index.css`), never raw values. Layout splits at `wide:`/`max-wide:`; hide-until-hover only behind `desktop-mouse:`. Text sizes in rem, fields never below 1rem, targets at least 24 px.
- Every control is shadcn's on Base UI (`src/web/components/ui/`: Button, Input, Textarea, Badge, Toggle, ToggleGroup, Tabs, Checkbox, Dialog, AlertDialog, Popover, Tooltip via `components/shell/hint.tsx`, DropdownMenu, Sonner); adjust with `className`. A form field is Base UI's `Field` around our `Input`. Add one with `bunx shadcn add <name>` (`--dry-run` first), point its `cn` import at `@/web/lib/utils`, and keep fields at 1rem. Icons from `lucide-react`.
- Components by feature (`components/{notes,editor,views,settings,shell}/`); kebab-case files; hooks in `src/web/hooks/<name>.hook.ts`; plain logic, tested without React, in `src/web/lib/`.
- State: server reads through TanStack Query hooks (`lib/queries.ts` keys; components never import `web/lib/api.ts`, `test/architecture.test.ts` checks); note writes only through the outbox, which settles into the cache; pins/views/picks are optimistic `useMutation`s; the open note is the `EditorSession` class (`useEditor`), whose `commit()` stays synchronous for `beforeunload`.
- A note body is markdown byte for byte (API contract): nothing rewrites it on save; Read-view ticks and Write-view helpers change only what the person acted on. The dialect lives in `src/shared/markdown.ts` (additive only); the renderer stays behind `components/editor/note-markdown.tsx`; a new body mode goes into `NoteEditor`. Pages are served under a CSP (`server/pages.ts`). See "Note bodies" in `docs/architecture.md`.
- A `src/web` file over 200 lines of code fails lint: split it; a component past ~8 props gets a hook or context instead.
- Browser behaviour (offline, tab close, stale answers, layout at 320/390/1280 px, keyboard) is tested in `test/e2e/` with `playwright-core` on the system Chrome (`CHROME=…`; skipped without one).

The details are in "State in the PWA" and "Styling the PWA" in `docs/architecture.md`.

## Errors

Codes live in `src/shared/errors.ts` (add new ones there); bodies are `{ error: code, message }`. Clients fail with `ApiError` (status, code, message) from `src/client/client.ts`; the PWA reads bodies with `readError()`.

## Schema changes

Append a `{ id: "000N.name", statements }` to `MIGRATIONS` in `src/server/storage/migrations.ts`. Never edit, rename or reorder a shipped one. Don't use `IF NOT EXISTS` in new ones. Add a test in `test/server/migrations.test.ts` if it transforms data (`onFreshDb` + `migrateWith`).

## Check

```bash
bun test && bun run lint && bun run typecheck
```

Fix lint findings rather than disabling rules; if a rule must change, use a scoped override in `oxlint.config.ts` with a comment giving the reason.
