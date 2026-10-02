// Notes: create, read, change, delete and search.
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";

import { progress } from "@/shared/checklist";
import type { Note, NoteInput, Tag } from "@/shared/domain";
import { newId } from "@/shared/ids";
import { deriveTitle } from "@/shared/title";

import { NoteChanged, NoteExists, NoteNotFound } from "./errors";
import { type makeRevisions, sameContent } from "./revisions";
import { decodeNote } from "./rows";
import { nowIso, run } from "./sql";

export type ListQuery = {
  /** Full-text search words; the search operators are parsed before this (shared/query.ts). */
  q?: string;
  kind?: string;
  /** `human`, `agent` (anyone else), or an author's name. */
  author?: string;
  /** Notes must carry every one of these. */
  tags?: readonly string[];
  limit?: number;
  offset?: number;
};

const normTags = (tags: unknown): string[] =>
  Array.isArray(tags)
    ? [...new Set(tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean))]
    : [];

export const makeNotes = (
  sql: SqlClient.SqlClient,
  record: ReturnType<typeof makeRevisions>["record"],
) => {
  const findNote = (id: string) =>
    Effect.flatMap(sql`SELECT * FROM notes WHERE id = ${id}`, (rows) =>
      rows[0] ? Effect.map(decodeNote(rows[0]), Option.some) : Effect.succeed(Option.none()),
    );

  const getNote = (id: string) =>
    Effect.flatMap(findNote(id), (found) =>
      Option.isSome(found) ? Effect.succeed(found.value) : Effect.fail(new NoteNotFound({ id })),
    );

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

    tags: run(
      sql<Tag>`SELECT value AS tag, COUNT(*) AS count FROM notes, json_each(notes.tags)
               GROUP BY value ORDER BY count DESC, tag`,
    ).pipe(Effect.map((rows) => [...rows])),
  };
};
