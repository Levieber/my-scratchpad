// How a row of SQLite becomes the API's shapes.
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { progress } from "@/shared/checklist";
import { FullRevision, Kind, type Note } from "@/shared/domain";

// Tags are a JSON array in one column; the rest of a row is already the API's shape.
const StoredTags = Schema.fromJsonString(Schema.mutable(Schema.Array(Schema.String)));
const NoteRow = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  body: Schema.String,
  tags: StoredTags,
  kind: Kind,
  author: Schema.String,
  created_at: Schema.String,
  updated_at: Schema.String,
  parent_id: Schema.NullOr(Schema.String),
  subpages: Schema.Number,
});
const RevisionRow = Schema.Struct({ ...FullRevision.fields, tags: StoredTags });

/** A note's columns from `notes n`, with what is derived from other rows. */
export const NOTE_COLUMNS =
  "n.*, (SELECT COUNT(*) FROM notes c WHERE c.parent_id = n.id) AS subpages";

// A row that doesn't decode means the database is corrupt, not that the caller erred.
export const decodeNote = (row: unknown): Effect.Effect<Note> =>
  Schema.decodeUnknownEffect(NoteRow)(row).pipe(
    Effect.map((r) => ({ ...r, progress: progress(r.body) })),
    Effect.orDie,
  );
export const decodeRevision = (row: unknown): Effect.Effect<FullRevision> =>
  Schema.decodeUnknownEffect(RevisionRow)(row).pipe(Effect.orDie);
