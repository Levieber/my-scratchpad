// Pinned notes: the few the home page shows above the list, in the order they were pinned.
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";

import { MAX_PINS } from "@/shared/pins";

import { NoteNotFound, PinLimit } from "./errors";
import { decodeNote, NOTE_COLUMNS } from "./rows";
import { nowIso, run } from "./sql";

export const makePins = (sql: SqlClient.SqlClient) => {
  /** Pinning a pinned note changes nothing ("skipped"), so a retried request can't hit the limit. */
  const insertPin = (id: string, pinnedAt?: string) =>
    Effect.gen(function* () {
      const note = yield* sql`SELECT 1 FROM notes WHERE id = ${id}`;
      if (!note.length) return yield* new NoteNotFound({ id });
      const pinned = yield* sql<{ note_id: string }>`SELECT note_id FROM pins`;
      if (pinned.some((p) => p.note_id === id)) return "skipped";
      if (pinned.length >= MAX_PINS) return yield* new PinLimit({ max: MAX_PINS });
      yield* sql`INSERT INTO pins ${sql.insert({ note_id: id, pinned_at: pinnedAt ?? (yield* nowIso) })}`;
      return "created";
    }).pipe(sql.withTransaction);

  return {
    // The row id breaks a tie between pins made at the same moment, as an import makes them.
    pins: run(
      Effect.flatMap(
        sql`SELECT ${sql.literal(NOTE_COLUMNS)} FROM pins p JOIN notes n ON n.id = p.note_id
            ORDER BY p.pinned_at, p.rowid`,
        (rows) => Effect.forEach(rows, decodeNote),
      ),
    ),

    /** The pins as written to an export: which note, and when. */
    pinRows: run(
      sql<{
        note_id: string;
        pinned_at: string;
      }>`SELECT note_id, pinned_at FROM pins ORDER BY pinned_at, rowid`,
    ).pipe(Effect.map((rows) => [...rows])),

    pin: (id: string) => run(Effect.asVoid(insertPin(id))),

    /** A pin from an export, with the date it was pinned. */
    importPin: (id: string, pinnedAt?: string) => run(insertPin(id, pinnedAt)),

    /** Unpinning a note that isn't pinned succeeds; only a note that doesn't exist fails. */
    unpin: (id: string) =>
      run(
        Effect.gen(function* () {
          const note = yield* sql`SELECT 1 FROM notes WHERE id = ${id}`;
          if (!note.length) return yield* new NoteNotFound({ id });
          yield* sql`DELETE FROM pins WHERE note_id = ${id}`;
        }),
      ),
  };
};
