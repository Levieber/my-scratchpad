// A note's history: what is recorded when it changes, and how it is read back.
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as SqlClient from "effect/sql/SqlClient";

import { diffStats } from "@/shared/diff/lines";
import { type Note, withoutBody } from "@/shared/domain";

import { RevisionNotFound } from "./errors";
import { decodeRevision } from "./rows";
import { run } from "./sql";

/** How long after a revision further saves by the same author still belong to it. */
export const REVISION_WINDOW_MS = 5 * 60_000;

type Content = Pick<Note, "title" | "body" | "tags" | "kind">;

// What a revision records; pinning is a view setting, not an edit.
export const sameContent = (a: Content, b: Content) =>
  a.title === b.title &&
  a.body === b.body &&
  a.kind === b.kind &&
  JSON.stringify(a.tags) === JSON.stringify(b.tags);

export const makeRevisions = (sql: SqlClient.SqlClient) => {
  /**
   * Adds `note`'s content to its history, or folds it into the latest revision when the same
   * author saved within the window. A folded revision that ends up equal to the one before it
   * (an edit typed and then undone) is dropped.
   */
  const record = Effect.fnUntraced(function* (note: Note, author: string) {
    const rows =
      yield* sql`SELECT * FROM note_revisions WHERE note_id = ${note.id} ORDER BY id DESC LIMIT 2`;
    const [last, before] = yield* Effect.forEach(rows, decodeRevision);
    const fold =
      last?.author === author &&
      Date.parse(note.updated_at) - Date.parse(last.updated_at) < REVISION_WINDOW_MS;
    const previous = fold ? before : last;
    if (fold && previous && sameContent(previous, note)) {
      yield* sql`DELETE FROM note_revisions WHERE id = ${last.id}`;
      return;
    }
    const content = {
      title: note.title,
      body: note.body,
      tags: JSON.stringify(note.tags),
      kind: note.kind,
      updated_at: note.updated_at,
      ...diffStats(previous?.body ?? "", note.body),
    };
    if (fold) yield* sql`UPDATE note_revisions SET ${sql.update(content)} WHERE id = ${last.id}`;
    else
      yield* sql`INSERT INTO note_revisions ${sql.insert({ ...content, note_id: note.id, author })}`;
  });

  const revisionRows = (rows: readonly unknown[]) =>
    Effect.map(Effect.forEach(rows, decodeRevision), (all) => all.map(withoutBody));
  const firstRevision = (rows: readonly unknown[]) =>
    rows[0] ? Effect.map(decodeRevision(rows[0]), Option.some) : Effect.succeed(Option.none());

  return {
    record,

    /** A note's history, newest first, without bodies. */
    revisions: (noteId: string, { limit = 50, offset = 0 } = {}) =>
      run(
        Effect.flatMap(
          sql`SELECT * FROM note_revisions WHERE note_id = ${noteId}
              ORDER BY id DESC LIMIT ${Math.min(limit, 500)} OFFSET ${offset}`,
          revisionRows,
        ),
      ),

    revision: (noteId: string, id: number) =>
      run(
        Effect.flatMap(
          sql`SELECT * FROM note_revisions WHERE note_id = ${noteId} AND id = ${id}`,
          (rows) => (rows[0] ? decodeRevision(rows[0]) : Effect.fail(new RevisionNotFound({ id }))),
        ),
      ),

    /** The revision just before `id`; none when `id` is the first. */
    previousRevision: (noteId: string, id: number) =>
      run(
        Effect.flatMap(
          sql`SELECT * FROM note_revisions WHERE note_id = ${noteId} AND id < ${id}
              ORDER BY id DESC LIMIT 1`,
          firstRevision,
        ),
      ),

    /** The latest revision, or the latest saved at or before `until` (an ISO timestamp). */
    latestRevision: (noteId: string, until?: string) =>
      run(
        Effect.flatMap(
          until === undefined
            ? sql`SELECT * FROM note_revisions WHERE note_id = ${noteId} ORDER BY id DESC LIMIT 1`
            : sql`SELECT * FROM note_revisions WHERE note_id = ${noteId} AND updated_at <= ${until}
                  ORDER BY id DESC LIMIT 1`,
          firstRevision,
        ),
      ),
  };
};
