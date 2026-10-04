// Moving notes in and out as a JSON archive (docs/export-format.md).
import * as Argument from "effect/cli/Argument";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { author, kind, tag } from "@/cli/flags";
import { out, reported, usage } from "@/cli/root";
import { exportNotes, importFile } from "@/client/transfer";
import type { ImportResult, ImportTally } from "@/shared/archive";

const OLDER_SERVER =
  "this server is older and has no archive: only the notes are moved, without history, views or pins";

export const exportCmd = Command.make(
  "export",
  {
    file: Argument.String("file").pipe(Argument.optional),
    tag,
    kind,
    author,
    noHistory: Flag.Boolean("no-history").pipe(
      Flag.withDescription("Leave each note's revisions out (a smaller file)"),
      Flag.withDefault(false),
    ),
  },
  Effect.fn(function* (a) {
    const exported = yield* exportNotes(
      {
        tag: a.tag,
        kind: Option.getOrUndefined(a.kind),
        author: Option.getOrUndefined(a.author),
      },
      { history: !a.noHistory },
    );
    // On stderr, so what goes to a pipe or a file is still only the JSON.
    if (exported.fallback) yield* Console.error(`pad: ${OLDER_SERVER}.`);
    const text = JSON.stringify(exported.data, null, 2) + "\n";
    const file = Option.filter(a.file, (f) => f !== "-");
    if (Option.isNone(file)) return yield* Effect.sync(() => void process.stdout.write(text));
    yield* Effect.promise(() => Bun.write(file.value, text));
    yield* out(
      { exported: exported.notes, file: file.value, history: exported.history },
      () =>
        `exported ${exported.notes} notes to ${file.value}` +
        (exported.history ? " with their history" : ""),
    );
  }, reported),
).pipe(
  Command.withDescription(
    "Write notes, their history, views and pins as a JSON archive (stdout or file)",
  ),
);

const tally = (label: string, t: ImportTally) =>
  t.created || t.skipped ? `\n${label}: created ${t.created}, skipped ${t.skipped} existing` : "";

const describe = (result: ImportResult) =>
  `created ${result.created}, skipped ${result.skipped} existing` +
  tally("views", result.views) +
  tally("pins", result.pins) +
  tally("hook selections", result.hook_selections) +
  result.failed.map((f) => `\n${f.item}: ${f.message}`).join("") +
  (result.failed.length ? `\nfailed ${result.failed.length}` : "");

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
    const { result, fallback } = yield* importFile(text);
    if (fallback) yield* Console.error(`pad: ${OLDER_SERVER}.`);
    yield* out(result, () => describe(result));
    if (result.failed.length) process.exitCode = 1;
  }, reported),
).pipe(
  Command.withDescription(
    "Import a `pad export` archive (file or stdin); notes that exist are left as they are",
  ),
);
