// Creating, reading, changing and deleting one note.
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as Command from "effect/cli/Command";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { id, kind, tag, title, words } from "@/cli/flags";
import { full, line } from "@/cli/format";
import { out, reported, textArg, usage } from "@/cli/root";
import { ApiError, Client } from "@/client/client";

// No --tag means "leave the tags alone", not "no tags".
const tagsOrUndefined = (tags: readonly string[]) => (tags.length ? [...tags] : undefined);

export const add = Command.make(
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

export const show = Command.make(
  "show",
  { id },
  Effect.fn(function* (a) {
    const n = yield* (yield* Client).get(a.id);
    yield* out(n, () => full(n));
  }, reported),
).pipe(Command.withAlias("cat"), Command.withDescription("Print a note"));

export const append = Command.make(
  "append",
  { id, text: words("text") },
  Effect.fn(function* (a) {
    const text = yield* textArg(a.text);
    if (!text) return yield* usage("Nothing to append.");
    const n = yield* (yield* Client).append(a.id, text);
    yield* out(n, () => n.id);
  }, reported),
).pipe(Command.withDescription("Append a line (text or stdin)"));

export const edit = Command.make(
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

export const set = Command.make(
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

export const rm = Command.make(
  "rm",
  { id },
  Effect.fn(function* (a) {
    yield* (yield* Client).delete(a.id);
    yield* out({ deleted: a.id }, () => `deleted ${a.id}`);
  }, reported),
).pipe(Command.withAlias("delete"), Command.withDescription("Delete a note"));
