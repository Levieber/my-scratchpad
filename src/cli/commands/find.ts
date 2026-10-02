// Finding notes: search, tags and saved searches.
import * as Argument from "effect/cli/Argument";
import * as Command from "effect/cli/Command";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { author, kind, limit, tag, words } from "@/cli/flags";
import { line } from "@/cli/format";
import { out, reported } from "@/cli/root";
import { ApiError, Client } from "@/client/client";

const findView = Effect.fn(function* (name: string) {
  const views = yield* (yield* Client).views();
  const view = views.find((v) => v.name.toLowerCase() === name.toLowerCase());
  if (!view) return yield* new ApiError({ status: 404, message: `No saved view named "${name}".` });
  return view;
});

export const ls = Command.make(
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

export const tags = Command.make(
  "tags",
  {},
  Effect.fn(function* () {
    const all = yield* (yield* Client).tags();
    yield* out(all, () => all.map((t) => `#${t.tag} (${t.count})`).join("\n") || "(no tags)");
  }, reported),
).pipe(Command.withDescription("List tags"));

export const views = Command.make(
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
