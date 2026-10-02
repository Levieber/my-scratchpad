#!/usr/bin/env bun
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import { HOOK_RUNNERS } from "@integrations/claude-code/hooks";
import * as Argument from "effect/cli/Argument";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import { ApiError, Client } from "./client";
import { ClientConfig } from "./config";
import type { Note } from "./domain";
import { KIND_NAMES } from "./kinds";
import { exportNotes, importNotes, parseExport } from "./transfer";

// Who `pad` writes as: PAD_AUTHOR, else claude-code when Claude Code runs it, else the human.
const Author = Config.all([
  Config.option(Config.String("PAD_AUTHOR")),
  Config.option(Config.String("CLAUDECODE")),
]).pipe(
  Config.map(([author, claude]) =>
    Option.getOrElse(author, () => (Option.isSome(claude) ? "claude-code" : "human")),
  ),
);

const ago = (iso: string) => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};

// Progress means something on a to-do list; on a reference checklist it's just the item count.
const done = (n: Note) =>
  n.kind === "note" && n.progress.total ? ` ${n.progress.done}/${n.progress.total}` : "";

const line = (n: Note) =>
  `${n.id}  ${n.title}${done(n)}${n.kind === "note" ? "" : ` [${n.kind}]`}${n.tags.length ? "  #" + n.tags.join(" #") : ""}  (${ago(n.updated_at)}, ${n.author})`;

const full = (n: Note) =>
  `${n.title}\nid: ${n.id} · by ${n.author} · updated ${n.updated_at}${
    n.tags.length ? " · #" + n.tags.join(" #") : ""
  }\n\n${n.body}`;

const usage = (message: string) => new ApiError({ status: 400, message });

// --- flags shared by several commands -------------------------------------------------------

const json = Flag.Boolean("json").pipe(
  Flag.withDescription("Machine-readable output"),
  Flag.withDefault(false),
);
const tag = Flag.String("tag").pipe(Flag.atLeast(0), Flag.withDescription("Repeatable"));
const kind = Flag.Literals("kind", KIND_NAMES).pipe(Flag.optional);
const author = Flag.String("author").pipe(
  Flag.withDescription("human, agent, or an author's name"),
  Flag.optional,
);
const limit = Flag.Int("limit").pipe(Flag.withAlias("n"), Flag.optional);
const title = Flag.String("title").pipe(Flag.withAlias("t"), Flag.optional);
const id = Argument.String("id");
const words = (name: string) => Argument.String(name).pipe(Argument.variadic());

// No --tag means "leave the tags alone", not "no tags".
const tagsOrUndefined = (tags: readonly string[]) => (tags.length ? [...tags] : undefined);

const pad = Command.make("pad").pipe(
  Command.withSharedFlags({ json }),
  Command.withDescription(
    `pad — scratchpad CLI.

Import keeps ids, so re-importing skips notes that exist; the author becomes you, not the original.
Kinds: ${KIND_NAMES.join(", ")}. Search operators: pad ls kind:reference author:agent '#launch' seo (author: human, agent, or a name)
Env (overrides \`pad login\`): PAD_URL, PAD_TOKEN, PAD_AUTHOR.`,
  ),
);

/** API errors become one line on stderr (or a JSON error with --json) and exit status 1. */
const reported = <A, E, R>(effect: Effect.Effect<A, E | ApiError, R>) =>
  Effect.catchIf(
    effect,
    (e): e is ApiError => e instanceof ApiError,
    (e) =>
      Effect.flatMap(pad, ({ json }) =>
        Console.error(json ? JSON.stringify({ error: e.message }) : `pad: ${e.message}`),
      ).pipe(Effect.andThen(Effect.sync(() => void (process.exitCode = 1)))),
    Effect.fail,
  );

/** Prints `data` as JSON with --json, else as `human()` says. */
const out = (data: unknown, human: () => string) =>
  Effect.flatMap(pad, ({ json }) => Console.log(json ? JSON.stringify(data, null, 2) : human()));

/** The text given as words, else piped on stdin, else "". */
const textArg = (rest: readonly string[]) =>
  rest.length
    ? Effect.succeed(rest.join(" "))
    : process.stdin.isTTY
      ? Effect.succeed("")
      : Effect.promise(() => Bun.stdin.text()).pipe(Effect.map((t) => t.replace(/\n$/, "")));

// --- commands ----------------------------------------------------------------------------------

const add = Command.make(
  "add",
  { text: words("text"), title, tag, kind },
  Effect.fn(function* (a) {
    const body = yield* textArg(a.text);
    if (!body && Option.isNone(a.title))
      return yield* usage("Nothing to add: pass text or pipe stdin.");
    const n = yield* (yield* Client).create({
      title: Option.getOrUndefined(a.title),
      body,
      tags: tagsOrUndefined(a.tag),
      kind: Option.getOrUndefined(a.kind),
    });
    yield* out(n, () => n.id);
  }, reported),
).pipe(Command.withAlias("new"), Command.withDescription("Create a note (text or stdin)"));

const findView = Effect.fn(function* (name: string) {
  const views = yield* (yield* Client).views();
  const view = views.find((v) => v.name.toLowerCase() === name.toLowerCase());
  if (!view) return yield* new ApiError({ status: 404, message: `No saved view named "${name}".` });
  return view;
});

const ls = Command.make(
  "ls",
  { query: words("query"), tag, kind, author, limit },
  Effect.fn(function* (a) {
    // `@name` stands for a saved search's query, so it can be combined with more words.
    const expanded = yield* Effect.forEach(a.query, (word) =>
      word.startsWith("@")
        ? Effect.map(findView(word.slice(1)), (v) => v.query)
        : Effect.succeed(word),
    );
    const notes = yield* (yield* Client).list({
      q: expanded.join(" ") || undefined,
      tag: a.tag,
      kind: Option.getOrUndefined(a.kind),
      author: Option.getOrUndefined(a.author),
      limit: Option.getOrUndefined(a.limit),
    });
    yield* out(notes, () => notes.map(line).join("\n") || "(no notes)");
  }, reported),
).pipe(
  Command.withAlias("list"),
  Command.withDescription("List / search; `@<view>` runs a saved search"),
);

const show = Command.make(
  "show",
  { id },
  Effect.fn(function* (a) {
    const n = yield* (yield* Client).get(a.id);
    yield* out(n, () => full(n));
  }, reported),
).pipe(Command.withAlias("cat"), Command.withDescription("Print a note"));

const append = Command.make(
  "append",
  { id, text: words("text") },
  Effect.fn(function* (a) {
    const text = yield* textArg(a.text);
    if (!text) return yield* usage("Nothing to append.");
    const n = yield* (yield* Client).append(a.id, text);
    yield* out(n, () => n.id);
  }, reported),
).pipe(Command.withDescription("Append a line (text or stdin)"));

const edit = Command.make(
  "edit",
  { id },
  Effect.fn(function* (a) {
    const c = yield* Client;
    const n = yield* c.get(a.id);
    const file = join(tmpdir(), `pad-${n.id}.md`);
    const editor = process.env.VISUAL ?? process.env.EDITOR ?? "vi";
    const code = yield* Effect.promise(async () => {
      await Bun.write(file, n.body);
      return Bun.spawn([...editor.split(" "), file], { stdio: ["inherit", "inherit", "inherit"] })
        .exited;
    });
    if (code !== 0)
      return yield* new ApiError({
        status: 1,
        message: "Editor exited with an error; note unchanged.",
      });
    const body = yield* Effect.promise(() => Bun.file(file).text());
    if (body === n.body) return yield* out(n, () => "unchanged");
    const u = yield* c.update(n.id, { body });
    yield* out(u, () => u.id);
  }, reported),
).pipe(Command.withDescription("Edit the body in $EDITOR"));

const set = Command.make(
  "set",
  { id, title, tag, kind },
  Effect.fn(function* (a) {
    const n = yield* (yield* Client).update(a.id, {
      title: Option.getOrUndefined(a.title),
      tags: tagsOrUndefined(a.tag),
      kind: Option.getOrUndefined(a.kind),
    });
    yield* out(n, () => line(n));
  }, reported),
).pipe(Command.withDescription("Update metadata"));

const rm = Command.make(
  "rm",
  { id },
  Effect.fn(function* (a) {
    yield* (yield* Client).delete(a.id);
    yield* out({ deleted: a.id }, () => `deleted ${a.id}`);
  }, reported),
).pipe(Command.withAlias("delete"), Command.withDescription("Delete a note"));

const history = Command.make(
  "history",
  { id, limit },
  Effect.fn(function* (a) {
    const revs = yield* (yield* Client).revisions(a.id, { limit: Option.getOrUndefined(a.limit) });
    yield* out(revs, () =>
      revs
        .map(
          (r) =>
            `${String(r.id).padStart(6)}  ${r.updated_at}  +${r.added} -${r.removed}  ${r.author}  ${r.title}`,
        )
        .join("\n"),
    );
  }, reported),
).pipe(Command.withAlias("log"), Command.withDescription("List a note's revisions"));

const diff = Command.make(
  "diff",
  {
    id,
    from: Flag.Int("from").pipe(Flag.withDescription("Revision id"), Flag.optional),
    to: Flag.Int("to").pipe(Flag.withDescription("Revision id"), Flag.optional),
    since: Flag.String("since").pipe(Flag.withDescription("ISO time"), Flag.optional),
  },
  Effect.fn(function* (a) {
    const d = yield* (yield* Client).diff(a.id, {
      from: Option.getOrUndefined(a.from),
      to: Option.getOrUndefined(a.to),
      since: Option.getOrUndefined(a.since),
    });
    const fields = Object.entries(d.changes).map(
      ([field, c]) => `${field}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`,
    );
    yield* out(d, () => [...fields, d.diff.trimEnd()].filter(Boolean).join("\n") || "(no changes)");
  }, reported),
).pipe(Command.withDescription("What changed (default: the latest change)"));

const exportCmd = Command.make(
  "export",
  { file: Argument.String("file").pipe(Argument.optional), tag, kind, author },
  Effect.fn(function* (a) {
    const notes = yield* exportNotes({
      tag: a.tag,
      kind: Option.getOrUndefined(a.kind),
      author: Option.getOrUndefined(a.author),
    });
    const text = JSON.stringify(notes, null, 2) + "\n";
    const file = Option.filter(a.file, (f) => f !== "-");
    if (Option.isNone(file)) return yield* Effect.sync(() => void process.stdout.write(text));
    yield* Effect.promise(() => Bun.write(file.value, text));
    yield* out(
      { exported: notes.length, file: file.value },
      () => `exported ${notes.length} notes to ${file.value}`,
    );
  }, reported),
).pipe(Command.withDescription("Write notes as JSON (stdout or file)"));

const importCmd = Command.make(
  "import",
  { file: Argument.String("file").pipe(Argument.optional) },
  Effect.fn(function* (a) {
    const file = Option.filter(a.file, (f) => f !== "-");
    if (Option.isNone(file) && process.stdin.isTTY)
      return yield* usage("Usage: pad import <file>, or pipe JSON on stdin.");
    const text = yield* Effect.tryPromise({
      try: () => (Option.isSome(file) ? Bun.file(file.value) : Bun.stdin).text(),
      catch: () => usage(`Cannot read ${Option.getOrElse(file, () => "stdin")}.`),
    });
    const result = yield* importNotes(yield* parseExport(text));
    yield* out(
      result,
      () =>
        `created ${result.created}, skipped ${result.skipped} existing` +
        result.failed.map((f) => `\nitem ${f.item}: ${f.message}`).join("") +
        (result.failed.length ? `\nfailed ${result.failed.length}` : ""),
    );
    if (result.failed.length) process.exitCode = 1;
  }, reported),
).pipe(Command.withDescription("Create notes from `pad export` JSON (file or stdin)"));

const tags = Command.make(
  "tags",
  {},
  Effect.fn(function* () {
    const all = yield* (yield* Client).tags();
    yield* out(all, () => all.map((t) => `#${t.tag} (${t.count})`).join("\n") || "(no tags)");
  }, reported),
).pipe(Command.withDescription("List tags"));

const views = Command.make(
  "views",
  {},
  Effect.fn(function* () {
    const all = yield* (yield* Client).views();
    yield* out(all, () => all.map((v) => `@${v.name}  ${v.query}`).join("\n") || "(no views)");
  }, reported),
).pipe(
  Command.withDescription("List, save or delete saved searches"),
  Command.withSubcommands([
    Command.make(
      "add",
      { name: Argument.String("name"), query: Argument.String("query").pipe(Argument.atLeast(1)) },
      Effect.fn(function* (a) {
        const v = yield* (yield* Client).createView(a.name, a.query.join(" "));
        yield* out(v, () => `saved ${v.name}: ${v.query}`);
      }, reported),
    ).pipe(Command.withDescription("Save a search")),
    Command.make(
      "rm",
      { name: Argument.String("name") },
      Effect.fn(function* (a) {
        const view = yield* findView(a.name);
        yield* (yield* Client).deleteView(view.id);
        yield* out({ deleted: view.name }, () => `deleted ${view.name}`);
      }, reported),
    ).pipe(Command.withAlias("delete"), Command.withDescription("Delete a saved search")),
  ]),
);

const status = Command.make(
  "status",
  {},
  Effect.fn(function* () {
    const config = yield* ClientConfig;
    const who = yield* Author;
    const ok = yield* (yield* Client)
      .health()
      .pipe(Effect.match({ onSuccess: () => true, onFailure: () => false }));
    const token = Option.isSome(config.token);
    const info = { url: config.url, reachable: ok, token, author: who, config: config.path };
    yield* out(
      info,
      () =>
        `${config.url}  ${ok ? "reachable" : "UNREACHABLE"}${token ? " (token set)" : ""}  as ${who}`,
    );
  }, reported),
).pipe(Command.withDescription("Show which server is in use"));

const login = Command.make(
  "login",
  { url: Argument.String("url"), token: Argument.String("token").pipe(Argument.optional) },
  Effect.fn(function* (a) {
    const url = a.url.replace(/\/$/, "");
    const token = Option.filter(
      Option.orElse(a.token, () =>
        Option.fromNullishOr(process.stdin.isTTY ? prompt("Token (blank for none):") : undefined),
      ),
      (t) => t !== "",
    );
    // Checked through the API itself: a notes request is the first thing that needs the token.
    yield* Effect.flatMap(Effect.service(Client), (c) => c.list({ limit: 1 })).pipe(
      Effect.provide(
        Client.layerWith({ url, author: "human", token: Option.map(token, Redacted.make) }),
      ),
      Effect.mapError((e) =>
        e.status === 0
          ? new ApiError({ status: 0, message: `Cannot reach ${url}` })
          : e.status === 401
            ? new ApiError({ status: 401, message: "Server rejected the token." })
            : e,
      ),
    );
    const { path } = yield* ClientConfig;
    yield* Effect.sync(() => {
      mkdirSync(dirname(path), { recursive: true });
      const saved = { url, token: Option.getOrUndefined(token) };
      writeFileSync(path, JSON.stringify(saved, null, 2) + "\n", { mode: 0o600 });
    });
    yield* out({ url, saved: path }, () => `Now using ${url} (saved to ${path})`);
  }, reported),
).pipe(Command.withDescription("Point CLI/MCP at a server (e.g. Railway)"));

const logout = Command.make(
  "logout",
  {},
  Effect.fn(function* () {
    const { path } = yield* ClientConfig;
    yield* Effect.sync(() => rmSync(path, { force: true }));
    yield* out({ removed: path }, () => "Back to the local server.");
  }, reported),
).pipe(Command.withDescription("Back to the local server"));

const serve = Command.make(
  "serve",
  {},
  Effect.fn(function* () {
    // Loaded only for this command: the rest of the CLI never needs the server's modules.
    const { main } = yield* Effect.promise(() => import("./server"));
    return yield* Effect.mapError(main, (e) => usage(e.message));
  }, reported),
).pipe(Command.withDescription("Run the API + PWA server"));

const open = Command.make(
  "open",
  {},
  Effect.fn(function* () {
    const { url } = yield* ClientConfig;
    const opener = process.platform === "darwin" ? "open" : "xdg-open";
    yield* Effect.sync(() => Bun.spawn([opener, url]));
  }, reported),
).pipe(Command.withDescription("Open the PWA in a browser"));

// Claude Code runs these (see integrations/claude-code/settings.ts); they live in the CLI so they
// start as fast as the compiled `pad` does.
const hook = Command.make("hook").pipe(
  Command.withDescription(
    "Claude Code hooks, run by Claude Code (installed by `bun run setup:claude`)",
  ),
  Command.withSubcommands(
    Object.entries(HOOK_RUNNERS).map(([name, run]) =>
      Command.make(
        name,
        {},
        Effect.fn(function* () {
          const event = yield* Effect.promise(() => Bun.stdin.json().catch(() => ({})));
          // Hooks only read; attributed as Claude Code all the same.
          yield* run(event).pipe(Effect.provide(Client.layer("claude-code")));
        }),
      ),
    ),
  ),
);

// --- wiring ----------------------------------------------------------------------------------

const commands = [
  add,
  ls,
  show,
  append,
  edit,
  set,
  rm,
  history,
  diff,
  exportCmd,
  importCmd,
  tags,
  views,
  status,
  login,
  logout,
  serve,
  open,
  hook,
] as const;

pad.pipe(
  Command.withSubcommands(commands),
  Command.run({ version: "0.1.0" }),
  Effect.provide(
    Layer.mergeAll(
      Layer.unwrap(
        Effect.gen(function* () {
          return Client.layer(yield* Author);
        }),
      ),
      ClientConfig.layer,
      BunServices.layer,
    ),
  ),
  BunRuntime.runMain,
);
