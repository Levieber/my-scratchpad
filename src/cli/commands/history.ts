// A note's past: its revisions and what changed between them.
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { id, limit } from "@/cli/flags";
import { out, reported } from "@/cli/root";
import { Client } from "@/client/client";

export const history = Command.make(
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

export const diff = Command.make(
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
