// Pinned notes: the few the home page shows above the list, in the order they were pinned.
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";

import { MAX_PINS } from "@/shared/pins";

import { NoteNotFound, PinLimit } from "./errors";
import { decodeNote } from "./rows";
import { nowIso, run } from "./sql";

export const makePins = (sql: SqlClient.SqlClient) => ({
  pins: run(
    Effect.flatMap(
      sql`SELECT n.* FROM pins p JOIN notes n ON n.id = p.note_id ORDER BY p.pinned_at`,
      (rows) => Effect.forEach(rows, decodeNote),
    ),
  ),

  /** Pinning a pinned note changes nothing, so a retried request can't hit the limit. */
  pin: (id: string) =>
    run(
      Effect.gen(function* () {
        const note = yield* sql`SELECT 1 FROM notes WHERE id = ${id}`;
        if (!note.length) return yield* new NoteNotFound({ id });
        const pinned = yield* sql<{ note_id: string }>`SELECT note_id FROM pins`;
        if (pinned.some((p) => p.note_id === id)) return;
        if (pinned.length >= MAX_PINS) return yield* new PinLimit({ max: MAX_PINS });
        yield* sql`INSERT INTO pins ${sql.insert({ note_id: id, pinned_at: yield* nowIso })}`;
      }).pipe(sql.withTransaction),
    ),

  /** Unpinning a note that isn't pinned succeeds; only a note that doesn't exist fails. */
  unpin: (id: string) =>
    run(
      Effect.gen(function* () {
        const note = yield* sql`SELECT 1 FROM notes WHERE id = ${id}`;
        if (!note.length) return yield* new NoteNotFound({ id });
        yield* sql`DELETE FROM pins WHERE note_id = ${id}`;
      }),
    ),
});
