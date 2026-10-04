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
    kinds.ts      Note kinds (note, reference); a use case is a tag, not a kind.
    query.ts      The search language (`kind:x author:x #tag words`); run by the server, edited by the PWA.
    checklist.ts  Markdown checkboxes → `progress` on every note.
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
    pwa.ts        The PWA files that live at the site root (service worker, manifest, the icons).
    observability.ts  A request id on every request and response, one log line per request, the JSON logger.
    docs/         openapi.ts (the contract at /openapi.json), llms.ts (the agent quick-start at /llms.txt).
    storage/      SQLite + FTS5 through effect/sql; knows nothing about HTTP.
      store.ts      The `Store` service and its layers: composes the five below, plus the health `ping`.
      notes.ts, revisions.ts, views.ts, pins.ts, hooks.ts   The queries, one file per area.
      errors.ts     What the store fails with besides a defect (NoteNotFound, NoteChanged, …).
      rows.ts       A row of SQLite → the API's shapes.
      sql.ts        What every query shares: SQL failures as defects, the clock.
      sqlite.ts     Opening the file, the pragmas, migrating.
      migrations.ts Named schema changes, recorded in schema_migrations.
  client/       Talking to the API as a client.
    client.ts     The `Client` service over HTTP, used by the CLI, the MCP server and the Claude Code hooks.
    transfer.ts   `pad export` / `pad import`: notes as a JSON array, built on the public API. Import keeps ids, so it is safe to repeat.
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
  web/          React PWA, bundled by Bun from the web/index.html import.
    index.css     The only stylesheet: Tailwind, the palette (light and dark), the breakpoint, base rules.
    lib/          api.ts (the API from a browser), sync.ts (the offline outbox and syncer), listing.ts, draft.ts, pins.ts (when a note can be pinned), hooks.ts (when a note can be hand-picked for an agent hook), storage.ts (localStorage), classes.ts (the repeated controls' class lists), utils.ts (shadcn's `cn`).
    components/   Sidebar (Filters, SavedViews, TagChips, NoteList), Editor, History, Splitter, TokenDialog, Settings (at /settings: which notes the agent hooks show).
      ui/           shadcn components, as `bunx shadcn add <name>` writes them (components.json).
    App.tsx       The state and effects that tie them together, and which page is open (it follows the address, shared/pages.ts); main.tsx mounts it.
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

The PWA builds offline editing on those two rules (`src/web/lib/sync.ts`):

- Every save goes into an **outbox** in localStorage first, with the version it started from; deletes too. The list shows the outbox applied, so notes written offline appear straight away.
- The **syncer** sends the outbox in order whenever it can (after a save, on each poll, on the `online` event, at startup). A `412` fetches the note, merges three-way (`merge3` in `src/shared/diff/merge.ts`, field by field for the rest) and retries. Where both sides changed the same lines, both are kept between git-style markers; both sides appending at one spot keeps both without markers.
- A note deleted elsewhere while edited here is recreated rather than losing the edit.
- The service worker serves cached GETs when the network is down and marks them with `x-pad-offline`, so the app can show that it is offline while still reading notes.

## Styling the PWA

Tailwind v4, utilities on the elements themselves; menus and other components with real interaction (focus, keyboard, positioning) come from [shadcn](https://ui.shadcn.com) on Base UI.

- `src/web/index.css` is the only stylesheet: Tailwind (with its preflight), the palette, and what is about elements rather than components. The palette is a set of variables named as shadcn names them (`--background`, `--card`, `--primary`, `--accent`, `--destructive`…), switched for dark mode, and mapped to Tailwind colors in `@theme inline`, so `bg-card` or `text-muted-foreground` follow the theme and shadcn's components follow it too. The base layer keeps the rules no utility can: fields at least 1rem (iOS), the placeholder color, disabled buttons.
- The breakpoint is `wide` (721 px, `wide:` and `max-wide:`): side by side above it, one column at a time below. `desktop-mouse:` is the one variant that assumes hovering (a wide screen with a mouse); anything hidden until hover hides behind it, so a phone always shows it. Tailwind's `hover:` already applies only where hovering exists.
- The controls the app repeats (buttons, chips, fields, badges) are class lists in `src/web/lib/classes.ts`; adjust one with `cn(button, "…")`. One-off styling stays on the element.
- Small text keeps the page's 1.5 line height (the `--text-*--line-height` overrides): Tailwind's tighter defaults would shrink chips below the 24 px tap target.
- Tailwind scans `src/web/` only (`source(none)` + `@source`): the default scan would read `repos/`.
- Add a component with `bunx shadcn add <name>` (`components.json`: style `base-vega`, lucide icons). The CLI may install an npm package named `cn` for the `cn` helper: remove it, and point the import at `@/web/lib/utils`. Keep the file whole; knip ignores its unused exports.
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
- `bunfig.toml`: dependencies are added with exact versions, and packages published less than a day ago are refused (`minimumReleaseAge`).
- `repos/` vendors upstream source for reference (Effect): `bun test` runs only `test/`, and every linter ignores it (oxlint also with `--disable-nested-config`, as `repos/effect` brings its own config).
- `test/e2e/` drives the PWA in a real browser: `playwright-core` (no Node runner, no browser download) launches the Chrome already installed, from `bun:test`, against `testServer()`. It covers what a fake DOM can't: going offline, a tab closed mid-edit (`beforeunload`), answers arriving late or out of order (`page.route`), real layout. With no Chrome found (`CHROME`, or `google-chrome`/`chromium` on the PATH) those tests are skipped, not failed. The logic itself stays tested as plain classes and functions in `test/web/`.
- Tests build the production layers with `test/support.ts` (`testServer`, `testStore` with a `TestClock`) and run effects through the fixture's `run`.
