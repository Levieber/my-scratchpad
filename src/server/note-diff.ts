// What `GET /api/notes/:id/diff` answers: two revisions of a note and what differs between them.
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { Store } from "@/server/storage/store";
import { unifiedDiff } from "@/shared/diff/unified";
import { type FullRevision, type NoteDiff, withoutBody } from "@/shared/domain";

import { positiveInt, refuse } from "./http";

/** Which of the fields besides the body differ between two revisions (`from` null: none yet). */
function fieldChanges(from: FullRevision | null, to: FullRevision) {
  const changes: NoteDiff["changes"] = {};
  for (const field of ["title", "tags", "kind"] as const) {
    const before = from ? from[field] : null;
    if (JSON.stringify(before) !== JSON.stringify(to[field]))
      changes[field] = { from: before, to: to[field] };
  }
  return changes;
}

const revisionLabel = (r: FullRevision | null) =>
  r ? `revision ${r.id} (${r.updated_at}, ${r.author})` : "empty";

/**
 * Two revisions of a note: `to` (default the latest) against `from` (default the one before
 * `to`), or against the note as it was at `since`, to see what changed after a given time.
 */
export const noteDiff = Effect.fnUntraced(function* (
  store: Store["Service"],
  noteId: string,
  p: URLSearchParams,
) {
  yield* store.get(noteId);
  const fromId = yield* positiveInt(p, "from");
  const toId = yield* positiveInt(p, "to");
  const sinceParam = p.get("since");
  if (sinceParam !== null && fromId !== undefined)
    return yield* refuse("invalidParam", 400, "Pass either from or since, not both");
  const sinceTime = sinceParam === null ? undefined : Date.parse(sinceParam);
  if (sinceTime !== undefined && Number.isNaN(sinceTime))
    return yield* refuse("invalidParam", 400, "since must be an ISO date-time");

  const to =
    toId === undefined
      ? yield* Effect.flatMap(store.latestRevision(noteId), (latest) =>
          Option.match(latest, {
            onNone: () => Effect.fail(refuse("revisionNotFound", 404)),
            onSome: Effect.succeed,
          }),
        )
      : yield* store.revision(noteId, toId);
  const from =
    fromId !== undefined
      ? yield* store.revision(noteId, fromId)
      : Option.getOrNull(
          yield* sinceTime !== undefined
            ? store.latestRevision(noteId, new Date(sinceTime).toISOString())
            : store.previousRevision(noteId, to.id),
        );
  return {
    note_id: noteId,
    from: from && withoutBody(from),
    to: withoutBody(to),
    changes: fieldChanges(from, to),
    diff: unifiedDiff(from?.body ?? "", to.body, [revisionLabel(from), revisionLabel(to)]),
  } satisfies NoteDiff;
});
