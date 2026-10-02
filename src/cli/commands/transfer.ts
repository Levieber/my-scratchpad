// Moving notes in and out as JSON.
import * as Argument from "effect/cli/Argument";
import * as Command from "effect/cli/Command";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { author, kind, tag } from "@/cli/flags";
import { out, reported, usage } from "@/cli/root";
import { exportNotes, importNotes, parseExport } from "@/client/transfer";

export const exportCmd = Command.make(
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

export const importCmd = Command.make(
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
