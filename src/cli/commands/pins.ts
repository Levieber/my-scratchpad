// The notes pinned to the home page.
import * as Command from "effect/cli/Command";
import * as Effect from "effect/Effect";

import { id } from "@/cli/flags";
import { line } from "@/cli/format";
import { out, reported } from "@/cli/root";
import { Client } from "@/client/client";
import { MAX_PINS } from "@/shared/pins";

export const pins = Command.make(
  "pins",
  {},
  Effect.fn(function* () {
    const notes = yield* (yield* Client).pins();
    yield* out(notes, () => notes.map(line).join("\n") || "(no pinned notes)");
  }, reported),
).pipe(Command.withDescription("List the pinned notes"));

export const pin = Command.make(
  "pin",
  { id },
  Effect.fn(function* (a) {
    yield* (yield* Client).pin(a.id);
    yield* out({ pinned: a.id }, () => `pinned ${a.id}`);
  }, reported),
).pipe(Command.withDescription(`Pin a note to the home page (at most ${MAX_PINS})`));

export const unpin = Command.make(
  "unpin",
  { id },
  Effect.fn(function* (a) {
    yield* (yield* Client).unpin(a.id);
    yield* out({ unpinned: a.id }, () => `unpinned ${a.id}`);
  }, reported),
).pipe(Command.withDescription("Unpin a note"));
