# Architecture

One rule shapes everything: **the HTTP API is the only way in.** People (PWA, CLI) and agents (MCP, curl, anything reading `/llms.txt`) use the same endpoints, so neither gets a capability the other lacks.

Everything but the PWA is written with Effect 4; why, and what it cost, is in [effect.md](effect.md).

Each folder of `src/` is one responsibility, and what it may import is enforced (below). The three process entry points stay at the root, because installed things name their paths (`claude mcp add`, the systemd unit, Railway's start command, `bin`); each is a few lines of wiring.

```
src/
  server.ts, cli.ts, mcp.ts   Entry points: `bun src/server.ts`, the `pad` executable, the MCP stdio server.
  shared/       Pure code every process uses, the PWA included. Imports no process, no node:/bun.
    domain.ts     The API's shapes as Schemas (Note, NoteInput, Revision, View); every client shares the types.
    validation.ts The sentences for a note that didn't decode (the API's 400 and `pad import`).
    errors.ts     Error codes + messages.
    archive.ts    The export archive (docs/export-format.md): its schemas, versions, `parseArchive`; pure, so any client can read one.
    kinds.ts      Note kinds (note, reference); a use case is a tag, not a kind.
    query.ts      The search language (`kind:x author:x #tag words`); run by the server, edited by the PWA.
    checklist.ts  Markdown checkboxes → `progress` on every note, and which line each task is on (what a tick in the PWA edits).
    markdown.ts   The markdown dialect of a note body, as the OpenAPI document and /llms.txt state it.
    diff/         lines.ts (Myers line diff, stats), unified.ts (`git diff` text), merge.ts (three-way merge).
    ids.ts, title.ts   Note ids (the PWA mints them too, for notes written offline) and the title derived from a body.
    hooks.ts      The agent hooks that show notes (their defaults), and scopes: where a selection applies (everywhere, a repository, a folder).
    pages.ts      The PWA's pages and their addresses: the server serves the app at each, the app reads which one it is on.
  server/       The HTTP API and the only code that touches the database.
    serve.ts      serverLayer and `main`: config, loopback/token check, BunHttpServer, JSON logs in production.
    routes.ts     The endpoints, one `resource` per path.
    resource.ts   How a path becomes a route: one handler per method, bearer check, error mapping (`guard`), 405 + Allow.
    http.ts       Reading a request (body, If-Match, query, paging) and writing a response or a refusal.
    note-diff.ts  What `GET /api/notes/:id/diff` computes.
    hook-notes.ts What the hook endpoints read, and the notes a hook shows an agent where it works.
    transfer.ts   `GET /api/export` and `POST /api/import` over HTTP: the size limit, the filename, the refusals.
    pwa.ts        The PWA files that live at the site root (service worker, manifest, the icons).
    pages.ts      The PWA's pages, served under the Content-Security-Policy.
    observability.ts  A request id on every request and response, one log line per request, the JSON logger.
    docs/         openapi.ts (the contract at /openapi.json), llms.ts (the agent quick-start at /llms.txt).
    storage/      SQLite + FTS5 through effect/sql; knows nothing about HTTP.
      store.ts      The `Store` service and its layers: composes the five below, plus the health `ping`.
      notes.ts, revisions.ts, views.ts, pins.ts, hooks.ts   The queries, one file per area.
      transfer.ts   Both ends of the archive: everything out in one read, a note with its revisions in (a transaction each); views, pins and hook selections come in through their own files.
      errors.ts     What the store fails with besides a defect (NoteNotFound, NoteChanged, …).
      rows.ts       A row of SQLite → the API's shapes.
      sql.ts        What every query shares: SQL failures as defects, the clock.
      sqlite.ts     Opening the file, the pragmas, migrating.
      migrations.ts Named schema changes, recorded in schema_migrations.
  client/       Talking to the API as a client.
    client.ts     The `Client` service over HTTP, used by the CLI, the MCP server and the Claude Code hooks.
    transfer.ts   `pad export` / `pad import` on `/api/export` and `/api/import`; against a server without them, the notes alone through the notes API. Import keeps ids, so it is safe to repeat.
    location.ts   Where a command or agent works: the repository's name (from its remote), the folder in it, the folder.
    hook-notes.ts What a hook shows there, from the server, or as before from a server older than hook selections.
  config/       Every env var and file under ~/.config/scratchpad, as Effect Config.
    env.ts        What they share (empty = unset, XDG folders, the port, reading a JSON file).
    server.ts, client.ts, hooks.ts   ServerConfig; ClientConfig (`pad login`); HookConfig (this machine's own hook searches, `pad hooks set --local`).
  cli/          `pad` (effect/cli); cli.ts wires it.
    root.ts       The root command, `out`, `reported` (API errors → one line, exit 1), the author.
    flags.ts, format.ts   Shared flags; how a note is printed for a person.
    commands/     notes.ts, find.ts (search, tags, saved views), pins.ts (pin, unpin, pins), history.ts, transfer.ts, connection.ts (status, login, serve…), hooks.ts.
  mcp/          tools.ts (names, descriptions, shapes), handlers.ts (what each does), server.ts (protocol, instructions); mcp.ts wires it.
  web/          React PWA, bundled by Bun from the web/index.html import. Files are kebab-case.
    index.css     The only stylesheet: Tailwind, the palette (light and dark), the breakpoint, base rules.
    lib/          Plain logic, tested without React: api.ts (the API from a browser), outbox.ts (edits the server doesn't have yet, in localStorage), sync.ts (sending them, merging), pending.ts (what the outbox means for the lists), editor-session.ts (the open note: autosave through the outbox, what the server answers, Read or Write), note-markdown.ts + autolinks.ts (a body read for the Read view), checklist-edit.ts (a tick), text-edit.ts (the Write view's helpers), editor-prefs.ts (the mode and font this device prefers), queries.ts (the read cache: TanStack Query's client, its keys, how a landed write settles into it), session.ts (the app's one session, wired to the cache; the token), store.ts (a value React can follow), failures.ts (what no component words itself: the token dialog, toasts, logging), listing.ts, draft.ts, pins.ts, hooks.ts (when a note can be pinned or hand-picked), storage.ts (localStorage), utils.ts (shadcn's `cn`).
    hooks/        `<name>.hook.ts`: how components read data and act (useNotes, usePins, usePinToggle, useHookPicks, useEditor, useOnline, usePending…); focus.ts holds the search and body refs.
    components/   By feature: shell/ (the frame, the splitter, the token dialog, Hint), notes/ (sidebar, list, rows, filters, tags, footer), views/ (saved searches), editor/ (the form, its toolbar, the body's editor in Read and Write (`note-editor.tsx`, `note-markdown.tsx`, `write-view.tsx`), history, the delete dialog), settings/ (at /settings: which notes the agent hooks show).
      ui/           shadcn components, as `bunx shadcn add <name>` writes them (components.json).
    app.tsx       The providers around the shell; main.tsx mounts it. Which page is open follows the address (shared/pages.ts, hooks/page.hook.ts).
public/           Files that must live at the site root: service worker, manifest, icon.
integrations/     Claude Code wiring: installer, hooks (run as `pad hook <name>`), skills.
test/             Mirrors src/ (server/, shared/, cli/, client/, mcp/, web/, integrations/), plus e2e/ (the PWA in a real browser); support.ts has the fixtures: the production layers on an in-memory database, in a ManagedRuntime.
```

## Boundaries, enforced

`test/architecture.test.ts` fails the build when an import crosses a boundary, and says why:

- Clients (`src/web/**`, `cli.ts` and `cli/`, `mcp.ts` and `mcp/`, `client/`, `integrations/**`) never import `server/` (routes, storage, anything), `bun:sqlite`, at runtime: they go through HTTP. (`pad serve` may import the server: it launches it, it doesn't call it.)
- `server/storage/**` knows nothing about HTTP: it imports nothing else of `server/`, `shared/errors.ts` or `effect/http`, and none of the clients.
- `server/**` doesn't import the clients; it is what they talk to.
- `shared/**` imports no process (`server`, `client`, `cli`, `mcp`, `config`, `web`, `integrations`) and no `node:`/`bun` module: the PWA uses it.
- `src/web/**` imports no `bun`/`node:` modules and not `config/` or `client/`: it runs in a browser. It imports no Effect either, which keeps it out of the bundle.
- `src/web/components/**` doesn't call `web/lib/api.ts`: components read and write through the hooks in `src/web/hooks/`, which own caching, polling and failures.
- Effect modules are imported by path (`effect/Effect`), never through a barrel (`effect`, `effect/http`, `@effect/platform-bun`): Bun loads a whole barrel at runtime, ~30 ms on every `pad` and hook run.
- No `../`, tests included: `@/` is `src/`, `@integrations/` is `integrations/`, `@test/` is `test/`, `./` is for a sibling in the same folder.

Type-only imports are always fine: sharing `Note` couples nothing at runtime.

## Adding a capability

1. API first: a route in `routes` (`src/server/routes.ts`; request and response helpers are in `http.ts`), its schema in `server/docs/openapi.ts` (and `llms.ts` if agents should know), a test in `test/server/api.test.ts`. A new shape goes in `shared/domain.ts`; a new storage outcome is a tagged error in `server/storage/errors.ts`, mapped in `guard` (`resource.ts`); the query goes in the storage file of its area.
2. Then the clients that need it: `client/client.ts` (+ a command in `cli/commands/`, a tool in `mcp/tools.ts` and its handler in `mcp/handlers.ts`), `web/lib/api.ts`.

## Routes

`routes(token)` (`server/routes.ts`) is a layer adding an `HttpRouter` route per path: `resource(path, { GET, POST, … })` (`resource.ts`) dispatches on the method, wraps each handler in `guard` (the bearer check and error mapping) and answers the methods a path doesn't define with `405` and an `Allow` header. Handlers are Effects that read the request (`HttpServerRequest`) and path params (`HttpRouter.params`); the store is yielded once, when the routes are built. `serverLayer` (`server/serve.ts`) serves them, with `requestLogging` around every route, on `BunHttpServer`, with Bun itself serving the HTML import at `/` (HMR in development). `main` reads `ServerConfig`, refuses a non-loopback address without `PAD_TOKEN`, and launches it all with `BunRuntime.runMain`.

## Errors

Every non-2xx body is `{ "error": "<code>", "message": "<english>" }`. The code (from `shared/errors.ts`, also an enum in `/openapi.json`) is the contract; the message is for people and agents reading raw responses.

- A handler refuses a request with `yield* refuse(code, status, detail?)`, an `HttpError`.
- The store fails with tagged errors (`NoteNotFound`, `NoteExists`, `NoteChanged`, `RevisionNotFound`, `ViewNotFound`, `ViewExists`, `PinLimit`, `HookLimit`, and `DatabaseUnavailable`, which only `ping` raises); `guard` maps each to its code and status, and the `Failure` type lists everything a handler may fail with.
- A defect (a bug, a broken database) is logged and answered with `500 internal`.

Clients get `ApiError` (`client/client.ts`) carrying the status and code.

## Observability

- **Request id.** Every response carries `x-request-id`: the platform's own (`x-railway-request-id`, then a caller's `x-request-id`) when it is a short run of plain characters, else one the server makes up. A line in the platform's access log therefore leads to ours. Anything else in the header is ignored, not cut down, since it is echoed back and logged.
- **One log line per request**: `request` with `requestId`, `method`, `path`, `status` and `durationMs` (level `ERROR` for a 5xx). The query string is never logged (it holds what the user searched for), nor is the Authorization header, and a healthy health check stays out. Everything logged while handling the request, a defect's cause included, carries the same `requestId`.
- **JSON in production.** With `NODE_ENV=production` the logger writes one JSON object per line (`message`, `level`, `timestamp`, `annotations`, and `cause` for failures); locally it stays human-readable. Read it with `railway logs --json | jq 'select(.annotations.requestId == "…")'`.
- **Health.** `GET /api/health` needs no token and reads a row of `notes` (`Store.ping`): `200 {"ok":true}`, or `503 unavailable` while the database can't answer, with the driver's error (`SQLITE_*` code and all) in the log, never in the body. Railway waits for it on every deploy.

Tests read what the server logs through `testServer().logs` instead of printing it.

## Storage and migrations

Notes live in one SQLite table with an FTS5 index kept in sync by triggers. `Store` is a service on `SqlClient` (`@effect/sql-sqlite-bun`, one connection); `Store.layer(path)` (`storage/sqlite.ts`) opens the file, turns on foreign keys and migrates before the store is handed out. Rows are decoded with Schemas; SQL failures are defects, so store signatures list only domain outcomes. Schema changes are named migrations in `src/server/storage/migrations.ts`, applied in one transaction on startup and recorded in `schema_migrations`:

- Append to the end of `MIGRATIONS`; never edit, rename or reorder one that has shipped.
- The runner is ours, not effect/sql's `Migrator`, which keeps numeric ids in its own table.
- Only `0001` and `0002` use `IF NOT EXISTS` — that is how databases created before named migrations (including the live Railway one) adopt them. New migrations must not need it.

## History

Every create and every content change (title, body, tags, kind; not pinning, which lives in its own `pins` table and leaves `updated_at` alone) is written to `note_revisions` in the same transaction, attributed to the `X-Pad-Author` of that request. Saves by one author within `REVISION_WINDOW_MS` (5 minutes) fold into the latest revision, so an autosaving editor records editing sessions, not keystrokes; a folded revision that ends up equal to the one before it is dropped. Each revision stores its full content plus lines added/removed, so diffs are computed on read (`GET /api/notes/:id/diff`) and any revision can be restored with a plain PATCH. Deleting a note deletes its history.

## Concurrent and offline writes

A note's `updated_at` is its version: note responses carry it as `ETag`, and `PATCH` with `If-Match` answers `412 noteChanged` when the note moved on. `Store.update` always advances `updated_at` by at least a millisecond, so two writes never share a version. `POST` accepts a client-chosen `id` (`409 noteExists` if taken), which makes a create safe to retry.

Requests run concurrently, so every check-then-write (If-Match, append, create with an id) runs in one `sql.withTransaction`. `test/api.test.ts` races writes to hold that.

The PWA builds offline editing on those two rules (`src/web/lib/outbox.ts`, `sync.ts`):

- Every save goes into an **outbox** in localStorage first, with the version it started from; deletes too. The list shows the outbox applied, so notes written offline appear straight away.
- The **syncer** sends the outbox in order whenever it can (after a save, on each poll, on the `online` event, at startup). A `412` fetches the note, merges three-way (`merge3` in `src/shared/diff/merge.ts`, field by field for the rest) and retries. Where both sides changed the same lines, both are kept between git-style markers; both sides appending at one spot keeps both without markers.
- A note deleted elsewhere while edited here is recreated rather than losing the edit.
- The service worker serves cached GETs when the network is down and marks them with `x-pad-offline`, so the app can show that it is offline while still reading notes.

## State in the PWA

Each kind of state has one home, as low as what needs it:

- **What the server has** (the list, tags, views, pins, a note, its history, the agent hooks' choices) is read through [TanStack Query](https://tanstack.com/query) (`src/web/lib/queries.ts`, read by the hooks in `src/web/hooks/`). Keys start with the server's origin, then the area and its parameters (`keys.list(q, limit)`, `keys.hookNotes(hook, scope)`). The list, tags, views, pins and the open note poll every 5 s while the page is visible and refetch when it becomes visible again (`refetchInterval`, `refetchOnWindowFocus`); the hooks' choices load once and after each change. Queries don't retry `Unauthorized` (the token dialog opens) or `Offline` (the footer says so, and the service worker answers from its cache). Query drops an answer overtaken by a newer request for the same key, so a slow response never puts back an older list, the reason it was adopted; it costs about 11 KB gz. Its devtools load in development only.
- **Writes to notes** never go through Query: they go into the outbox (`lib/outbox.ts`) and the syncer (`lib/sync.ts`) sends them. Each entry the server accepts settles into the cache at once (`settle` in `lib/queries.ts`: cancels reads already under way, keeping what is cached, and writes the server's note into every list, the pins and the note), and a sync run ends by invalidating the lists. Lists are read with `select: withPending(…)`, so an answer from before an edit never shows over it.
- **Pins, views and hook picks** are `useMutation`s: shown at once with `setQueryData`, rolled back if the server refuses, refetched after.
- **The open note** is an `EditorSession` (`lib/editor-session.ts`), a plain class like the outbox, followed with `useSyncExternalStore` (`useEditor`). It keeps the newest draft outside React so the autosave timer and `beforeunload` always commit what was typed, synchronously. A fresh copy from the server replaces what it shows only if it is newer and nothing is waiting to be saved.
- **The body's editor** is `NoteEditor` (`components/editor/note-editor.tsx`): `{ value, onChange, external, mode, readOnly }`, so the form and the outbox talk only to it and a richer editor later is one more mode. Read and Write are shadcn `Tabs`; an existing note opens in Read, a new one in Write, and each device remembers the last choice (`lib/editor-prefs.ts`, localStorage, which is per server already). `external` counts the times the session replaced the body from outside (a newer copy, a merge, a restore), for a mode that keeps its own copy.
- **Settings, History and the markdown renderer** sit behind `React.lazy`: their own chunk wherever the bundler splits (`Bun.build` with `splitting`). Bun.serve's HTML import doesn't split yet, so the server still sends them in the one chunk; the boundary is ready for when it does.
- **The search** (one query string, `useSearch`) is a context, since the box, the filters, the views, the tags and the list all edit it. Which page is open follows the address (`page.hook.ts`); layout (the list's width, whether it is hidden) stays in the shell.
- Not adopted, measured: TanStack Router (+28 KB gz for two pages that `shared/pages.ts` and a `popstate` listener serve), Hotkeys (three shortcuts), Form (forms are small), Virtual (the list pages by 50), DB and Store (overlap the outbox).

## Note bodies: the dialect and the Read view

**The body is markdown, byte for byte, and that is part of the API contract.** Agents and the CLI read and write it, `progress` counts its checkboxes, history and diffs are line-based, the outbox merges it line by line, and an export carries it between deployments. So nothing rewrites markdown on save: the Read view's tick changes one character of one line, and the Write view's helpers write what a person would have typed.

- **The dialect** is written down once, in `src/shared/markdown.ts`, and served in the OpenAPI description of `body` and in /llms.txt: CommonMark, plus GFM task lists, tables, strikethrough and autolinks, plus a versioned list of pad extensions (none yet). New syntax is additive only: an extension gets the next dialect version and must read as plain text where it isn't understood; changing what existing syntax means is a breaking change.
- **The renderer** is [TanStack Markdown](https://github.com/TanStack/markdown), pinned at 1.0.0 behind one component (`components/editor/note-markdown.tsx`), in a chunk of its own loaded with the Read view (~16 KB gz with highlighting). It escapes raw HTML and drops `javascript:` links, so no sanitizer runs; it is not full CommonMark. It doesn't autolink, so `lib/autolinks.ts` (an `inlineParser` extension, the same hook `[[links]]` would use) links `<https://…>` and bare http(s) addresses. An image in a note is shown as a link to it: nothing loads from an address a body names.
- **Fenced code** is highlighted by [TanStack Highlight](https://github.com/TanStack/highlight) (pinned at 1.0.0, `lib/highlight.ts`), registered with only the languages notes use (ts, sh/zsh/bash, json, toml); any other is shown as plain, escaped code. It loads in the Markdown chunk. Its output is set as HTML (the renderer's `highlighter` hook), so it is a trust boundary too: the code comes escaped, and the only markup is its `th-token` spans, which `test/web/note-markdown.test.tsx` checks. The tokens take the palette's colors through utilities on the `pre` (`markdown-elements.tsx`), so they follow light and dark.
- **Click to tick.** The renderer gives no source positions, so `lib/note-markdown.ts` numbers the rendered boxes in document order and the Nth box toggles the Nth task as `shared/checklist.ts` counts them (outside code fences, which close as CommonMark closes them: the same character, at least as many, so a shorter fence inside a longer one is text; an empty `- [ ]` placeholder is no task, and the renderer shows it as text too). Where the two readings disagree (a task inside a quote renders, but isn't counted), the boxes stay read-only rather than tick the wrong line. A tick is an edit like typing: into the draft, then the outbox. `test/web/markdown-corpus.test.tsx` renders a corpus of notes and expects as many boxes as `progress.total`; `PAD_CORPUS=<a pad export file>` runs it on real notes, which stay out of the repository.
- **The Write view** is the textarea, with a toolbar (bold, heading, bullet list, checklist, link), Ctrl/⌘+B, I and K (in the body, K makes a link; elsewhere it is still the search), Enter continuing a list and Enter on an empty item ending it, and a proportional-font toggle. Each helper is a pure function over the text and its selection (`lib/text-edit.ts`).
- **The CSP.** Bun serves the HTML import itself, with no way to add a header, so `server/pages.ts` serves the bundle at an unguessable address new on each start, and each page's address fetches it from there over loopback (~0.4 ms) and adds `Content-Security-Policy`: scripts, connections, images, the worker and the manifest from this site only, no plugins, no framing; inline styles are allowed (Base UI and Sonner set them at run time). Development also allows the dev server's inline script and its WebSocket. `test/server/pwa.test.ts` checks the header, and `test/e2e/csp.test.ts` that the service worker, manifest and icons still work and nothing is refused.
- A WYSIWYG editor is a later decision; any candidate would first have to round-trip every note in the corpus unchanged.

## Styling the PWA

Tailwind v4, utilities on the elements themselves; every control comes from [shadcn](https://ui.shadcn.com) on Base UI (`src/web/components/ui/`), so focus, keyboard and ARIA are the library's, the same everywhere.

- `src/web/index.css` is the only stylesheet: Tailwind (with its preflight), the palette, and what is about elements rather than components. The palette is a set of variables named as shadcn names them (`--background`, `--card`, `--primary`, `--accent`, `--destructive`…), switched for dark mode, and mapped to Tailwind colors in `@theme inline`, so `bg-card` or `text-muted-foreground` follow the theme and shadcn's components follow it too. The base layer keeps the rules no utility can: fields at least 1rem (iOS), the placeholder color, disabled buttons.
- The breakpoint is `wide` (721 px, `wide:` and `max-wide:`): side by side above it, one column at a time below. `desktop-mouse:` is the one variant that assumes hovering (a wide screen with a mouse); anything hidden until hover hides behind it, so a phone always shows it. Tailwind's `hover:` already applies only where hovering exists.
- Controls are shadcn's: `Button` (default for the one main action, `outline`, `ghost`; `icon` sizes), `Input`, `Textarea`, `Badge`, `Toggle` (Reference, History, Pin, the Write view's font), `Tabs` (Read and Write; Base UI marks orientation as `data-orientation`, not the `data-horizontal` shadcn's styles read, so the use site sets `flex-col`), `Checkbox` (a task in the Read view), `ToggleGroup` (the kind/author filters and the tags: one tab stop, arrow keys inside), `Dialog` (the token, which can't be dismissed), `AlertDialog` (deleting; `confirm()` is unreliable in an installed PWA and on iOS), `Popover` (naming a view), `Tooltip` (through `components/shell/hint.tsx`, in place of `title`, which touch and keyboard users never see; it also works on a disabled control), `DropdownMenu`, and Sonner's toasts for the API's refusals (`handle` in `lib/failures.ts`). Adjust one with `className`; `cn` merges it over the variant's classes. One-off styling stays on the element. The note list's rows, History's revisions and the splitter stay hand-made.
- A form field is Base UI's `Field` (`@base-ui/react/field`: `Field.Root` with `invalid`, `Field.Label`, `Field.Error`) around our `Input`: it ties the label, the control and the error together (`aria-invalid`, `aria-describedby`). shadcn's own `field.tsx` is layout only, so it isn't used.
- Dialogs, popovers, tooltips and toasts portal to the body, outside the `h-dvh` grid; the toasts keep out of the safe-area insets (`app.tsx`).
- Small text keeps the page's 1.5 line height (the `--text-*--line-height` overrides): Tailwind's tighter defaults would shrink chips below the 24 px tap target.
- Tailwind scans `src/web/` only (`source(none)` + `@source`): the default scan would read `repos/`.
- Add a component with `bunx shadcn add <name>` (`components.json`: style `base-vega`, lucide icons); try `--dry-run` first. The CLI writes `import { cn } from "cn"`: point it at `@/web/lib/utils`, which re-exports it. Keep the file whole (knip ignores its unused exports), with two exceptions: `Input` and `Textarea` lose `md:text-sm` (fields stay at 1rem at every width, which `test/web/styles.test.ts` checks on `ui/` too), and Sonner follows the system theme instead of `next-themes`. A component needing a palette token the app lacks gets it in `index.css` (light and dark).
- Files are kebab-case (`note-list.tsx`); hook files are `<name>.hook.ts`.
- Bun compiles the Tailwind through `bun-plugin-tailwind`, set in `bunfig.toml` (`[serve.static]`) for the server's HTML import, in dev and at startup. The `bun build` CLI doesn't read that setting, so the builds that bundle the PWA (`build`, `build:pad`) go through `scripts/build.ts`, which passes the plugin to `Bun.build`.

## The PWA on a phone

**Icons.** `public/icon.svg` is the source; `icon-maskable.svg` is the same artwork full-bleed. `bun run build:icons` (`scripts/build-icons.ts`, needs a Chrome) renders the committed PNGs from them: 192 and 512 px with the rounded corners (`any`), a 512 px maskable one (the OS crops it, so no corners of its own), and the 180 px `apple-touch-icon`. iOS ignores SVG icons and paints transparency black, so its icon is opaque and full-bleed (iOS rounds it). The manifest lists each icon for one purpose only: `any maskable` on one image suits neither. `index.html` links the apple-touch-icon statically, as a relative path the bundler turns into an asset; the manifest and the SVG icon are added by `main.tsx` (see there), and `server/pwa.ts` also serves every icon from the root, where iOS looks for `/apple-touch-icon.png` by itself. `test/server/pwa.test.ts` checks each icon's size and opacity.

**Responsiveness.** The rules, so a phone and its owner's settings work (`test/web/styles.test.ts` holds the checkable ones, on the CSS Tailwind compiles and on the components' class lists):

- Text sizes are `rem`, so the reader's text-size setting applies; nothing disables zoom in the viewport meta.
- Form fields are at least `1rem`: iOS Safari zooms into any smaller field when it is focused, and doesn't zoom back.
- Grid columns are `minmax(0, 1fr)`, never a bare `1fr`, which can't shrink below its content and pushes the page wider than the screen. Rows of controls wrap.
- Tap targets are at least 24×24 CSS px (WCAG 2.2). `env(safe-area-inset-*)` keeps the app out of a notch and the home indicator.

`test/e2e/layout.test.ts` measures the rendered page at 320, 390 and 1280 px, in the list, a menu, the editor, the history and Settings: no horizontal scroll, no target under 24 px, no field under 16 px; and goes from the list to the editor to deleting a note with the keyboard alone. Text size at 150 % and 200 % on 320 px is still a manual check. Bun's dev server gives assets stable URLs, which the service worker's cache-first rule then serves stale: unregister it, or test against `NODE_ENV=production`, which hashes asset names.

## Tooling

- `bun run lint` — oxlint (type-aware, incl. `no-deprecated` and jsx-a11y), oxfmt (formatting, sorted imports), knip (unused files/exports/deps), in parallel. `bun run lint:fix` fixes what it can.
- Change a lint rule with a scoped override and a comment giving the reason.
- In `src/web` (but not shadcn's `ui/`), a file over 200 lines of code fails lint (`max-lines`, comments and blank lines not counted): split it. `rules-of-hooks` is on there too.
- `bunfig.toml`: dependencies are added with exact versions, and packages published less than a day ago are refused (`minimumReleaseAge`).
- `repos/` vendors upstream source for reference (Effect): `bun test` runs only `test/`, and every linter ignores it (oxlint also with `--disable-nested-config`, as `repos/effect` brings its own config).
- `test/e2e/` drives the PWA in a real browser: `playwright-core` (no Node runner, no browser download) launches the Chrome already installed, from `bun:test`, against `testServer()`. It covers what a fake DOM can't: going offline, a tab closed mid-edit (`beforeunload`), answers arriving late or out of order (`page.route`), real layout. With no Chrome found (`CHROME`, or `google-chrome`/`chromium` on the PATH) those tests are skipped, not failed. The logic itself stays tested as plain classes and functions in `test/web/`.
- Tests build the production layers with `test/support.ts` (`testServer`, `testStore` with a `TestClock`) and run effects through the fixture's `run`.
