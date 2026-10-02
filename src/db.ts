import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import * as SqliteClient from "@effect/sql-sqlite-bun/SqliteClient";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlError from "effect/sql/SqlError";

import { progress } from "./checklist";
import { diffStats } from "./diff";
import {
  FullRevision,
  Kind,
  type Note,
  type NoteInput,
  withoutBody,
  type Tag,
  View,
} from "./domain";
import { newId } from "./ids";
import { migrate } from "./migrations";
import { deriveTitle } from "./title";

export type ListQuery = {
  /** Full-text search words; the search operators are parsed before this (src/query.ts). */
  q?: string;
  kind?: string;
  /** `human`, `agent` (anyone else), or an author's name. */
  author?: string;
  /** Notes must carry every one of these. */
  tags?: readonly string[];
  limit?: number;
  offset?: number;
};

export class NoteNotFound extends Schema.TaggedError<NoteNotFound>()("NoteNotFound", {
  id: Schema.String,
}) {}
export class NoteExists extends Schema.TaggedError<NoteExists>()("NoteExists", {
  id: Schema.String,
}) {}
/** The note moved on from the version the caller based its write on. */
export class NoteChanged extends Schema.TaggedError<NoteChanged>()("NoteChanged", {
  id: Schema.String,
}) {}
export class RevisionNotFound extends Schema.TaggedError<RevisionNotFound>()("RevisionNotFound", {
  id: Schema.Number,
}) {}
export class ViewNotFound extends Schema.TaggedError<ViewNotFound>()("ViewNotFound", {
  id: Schema.String,
}) {}
export class ViewExists extends Schema.TaggedError<ViewExists>()("ViewExists", {
  name: Schema.String,
}) {}

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
});
const RevisionRow = Schema.Struct({ ...FullRevision.fields, tags: StoredTags });

// A row that doesn't decode means the database is corrupt, not that the caller erred.
const decodeNote = (row: unknown): Effect.Effect<Note> =>
  Schema.decodeUnknownEffect(NoteRow)(row).pipe(
    Effect.map((r) => ({ ...r, progress: progress(r.body) })),
    Effect.orDie,
  );
const decodeRevision = (row: unknown): Effect.Effect<FullRevision> =>
  Schema.decodeUnknownEffect(RevisionRow)(row).pipe(Effect.orDie);

/** How long after a revision further saves by the same author still belong to it. */
export const REVISION_WINDOW_MS = 5 * 60_000;

type Content = Pick<Note, "title" | "body" | "tags" | "kind">;

// What a revision records; pinning is a view setting, not an edit.
const sameContent = (a: Content, b: Content) =>
  a.title === b.title &&
  a.body === b.body &&
  a.kind === b.kind &&
  JSON.stringify(a.tags) === JSON.stringify(b.tags);

const normTags = (tags: unknown): string[] =>
  Array.isArray(tags)
    ? [...new Set(tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean))]
    : [];

const nowIso = Effect.map(Clock.currentTimeMillis, (ms) => new Date(ms).toISOString());

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // SQL failures are defects here: the server answers them with `internal`, and no caller can
  // do anything better with them. Domain outcomes (not found, exists, changed) stay typed.
  const run = <A, E>(
    effect: Effect.Effect<A, E | SqlError.SqlError>,
  ): Effect.Effect<A, Exclude<E, SqlError.SqlError>> =>
    Effect.catchIf(effect, SqlError.isSqlError, Effect.die, Effect.fail);

  const findNote = (id: string) =>
    Effect.flatMap(sql`SELECT * FROM notes WHERE id = ${id}`, (rows) =>
      rows[0] ? Effect.map(decodeNote(rows[0]), Option.some) : Effect.succeed(Option.none()),
    );

  const getNote = (id: string) =>
    Effect.flatMap(findNote(id), (found) =>
      Option.isSome(found) ? Effect.succeed(found.value) : Effect.fail(new NoteNotFound({ id })),
    );

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

  const list = ({ q, kind, author, tags = [], limit = 50, offset = 0 }: ListQuery = {}) => {
    const where = [];
    let from = sql.literal("notes n");
    if (q?.trim()) {
      from = sql.literal("notes n JOIN notes_fts f ON f.rowid = n.rowid");
      // Quote each term so user input can't break FTS syntax; prefix-match the last one.
      const terms = q
        .trim()
        .split(/\s+/)
        .map((t) => `"${t.replace(/"/g, '""')}"`);
      terms[terms.length - 1] += "*";
      where.push(sql`notes_fts MATCH ${terms.join(" ")}`);
    }
    if (kind) where.push(sql`n.kind = ${kind}`);
    if (author) {
      if (author.toLowerCase() === "agent") where.push(sql`n.author <> 'human'`);
      else where.push(sql`lower(n.author) = ${author.toLowerCase()}`);
    }
    for (const tag of tags)
      where.push(sql`EXISTS (SELECT 1 FROM json_each(n.tags) WHERE value = ${tag.toLowerCase()})`);
    const filter = where.length ? sql`WHERE ${sql.and(where)}` : sql.literal("");
    return run(
      Effect.flatMap(
        sql`SELECT n.* FROM ${from} ${filter}
            ORDER BY n.updated_at DESC LIMIT ${Math.min(limit, 500)} OFFSET ${offset}`,
        (rows) => Effect.forEach(rows, decodeNote),
      ),
    );
  };

  const create = (input: NoteInput, author = "human") =>
    run(
      Effect.gen(function* () {
        const now = yield* nowIso;
        const body = input.body ?? "";
        const note: Note = {
          id: input.id ?? newId(),
          title: input.title?.trim() || deriveTitle(body),
          body,
          tags: normTags(input.tags),
          kind: input.kind ?? "note",
          author,
          created_at: now,
          updated_at: now,
          progress: progress(body),
        };
        // A client retrying a create whose response it never got learns it already succeeded.
        if (Option.isSome(yield* findNote(note.id))) return yield* new NoteExists({ id: note.id });
        const { progress: _, ...row } = note;
        yield* sql`INSERT INTO notes ${sql.insert({ ...row, tags: JSON.stringify(note.tags) })}`;
        yield* record(note, author);
        return note;
      }).pipe(sql.withTransaction),
    );

  const update = (
    id: string,
    patch: NoteInput,
    author = "human",
    /** Checked inside the write's transaction, so no other write can slip past it. */
    ifMatch: (current: Note) => boolean = () => true,
  ) =>
    run(
      Effect.gen(function* () {
        const cur = yield* getNote(id);
        if (!ifMatch(cur)) return yield* new NoteChanged({ id });
        const now = yield* Clock.currentTimeMillis;
        const next: Note = {
          ...cur,
          title:
            patch.title !== undefined
              ? patch.title.trim() || deriveTitle(patch.body ?? cur.body)
              : cur.title,
          body: patch.body ?? cur.body,
          tags: patch.tags !== undefined ? normTags(patch.tags) : cur.tags,
          kind: patch.kind ?? cur.kind,
          // Always later than the last write, even within one millisecond: updated_at is the
          // version clients send back in If-Match, so two writes must never share one.
          updated_at: new Date(Math.max(now, Date.parse(cur.updated_at) + 1)).toISOString(),
          progress: progress(patch.body ?? cur.body),
        };
        yield* sql`UPDATE notes SET ${sql.update({
          title: next.title,
          body: next.body,
          tags: JSON.stringify(next.tags),
          kind: next.kind,
          updated_at: next.updated_at,
        })} WHERE id = ${id}`;
        if (!sameContent(cur, next)) yield* record(next, author);
        return next;
      }).pipe(sql.withTransaction),
    );

  // One transaction around the read and the write: another request's write can't land between them.
  const append = (id: string, text: string, author = "human") =>
    run(
      Effect.gen(function* () {
        const cur = yield* getNote(id);
        const sep = cur.body && !cur.body.endsWith("\n") ? "\n" : "";
        return yield* update(id, { body: cur.body + sep + text }, author);
      }).pipe(sql.withTransaction),
    );

  const revisionRows = (rows: readonly unknown[]) =>
    Effect.map(Effect.forEach(rows, decodeRevision), (all) => all.map(withoutBody));
  const firstRevision = (rows: readonly unknown[]) =>
    rows[0] ? Effect.map(decodeRevision(rows[0]), Option.some) : Effect.succeed(Option.none());

  return {
    list,
    get: (id: string) => run(getNote(id)),
    create,
    update,
    append,

    delete: (id: string) =>
      run(
        Effect.flatMap(sql`DELETE FROM notes WHERE id = ${id} RETURNING id`, (rows) =>
          rows.length ? Effect.void : Effect.fail(new NoteNotFound({ id })),
        ),
      ),

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

    tags: run(
      sql<Tag>`SELECT value AS tag, COUNT(*) AS count FROM notes, json_each(notes.tags)
               GROUP BY value ORDER BY count DESC, tag`,
    ).pipe(Effect.map((rows) => [...rows])),

    views: run(
      Effect.flatMap(sql`SELECT * FROM views ORDER BY name`, (rows) =>
        Effect.forEach(rows, (row) => Effect.orDie(Schema.decodeUnknownEffect(View)(row))),
      ),
    ),

    /** Fails with ViewExists when a view with this name (ignoring case) exists already. */
    createView: (name: string, query: string) =>
      run(
        Effect.gen(function* () {
          const view: View = { id: newId(), name, query, created_at: yield* nowIso };
          const taken = yield* sql`SELECT 1 FROM views WHERE name = ${name}`;
          if (taken.length) return yield* new ViewExists({ name });
          yield* sql`INSERT INTO views ${sql.insert(view)}`;
          return view;
        }).pipe(sql.withTransaction),
      ),

    deleteView: (id: string) =>
      run(
        Effect.flatMap(sql`DELETE FROM views WHERE id = ${id} RETURNING id`, (rows) =>
          rows.length ? Effect.void : Effect.fail(new ViewNotFound({ id })),
        ),
      ),
  };
});

/** Notes and saved views in SQLite + FTS5. Only the server uses it. */
export class Store extends Context.Service<Store, Effect.Success<typeof make>>()("pad/Store") {
  /** On whatever SqlClient is provided; the database must already be migrated. */
  static readonly layerNoDeps = Layer.effect(Store, make);

  /** On a SQLite file (or `:memory:`), migrated before the store is handed out. */
  static readonly layer = (filename: string) =>
    Store.layerNoDeps.pipe(Layer.provideMerge(sqlite(filename)));
}

/** A migrated SQLite database, with the pragmas the schema relies on. */
export const sqlite = (filename: string) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      // Revisions are deleted with their note through ON DELETE CASCADE.
      yield* sql`PRAGMA foreign_keys = ON`;
      yield* migrate;
    }).pipe(Effect.orDie),
  ).pipe(
    Layer.provideMerge(
      Layer.unwrap(
        Effect.sync(() => {
          if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
          return SqliteClient.layer({ filename });
        }),
      ),
    ),
  );
