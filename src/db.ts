import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { openItems, type Progress, progress } from "./checklist";
import { DAILY_TAG, dailyBody, dailyTitle } from "./daily";
import { diffStats } from "./diff";
import { newId } from "./ids";
import type { Kind } from "./kinds";
import { migrate } from "./migrations";
import { deriveTitle } from "./title";

export type Note = {
  id: string;
  title: string;
  body: string;
  tags: string[];
  pinned: boolean;
  kind: Kind;
  author: string;
  created_at: string;
  updated_at: string;
  /** Derived from the body's checkboxes on every read, never stored. */
  progress: Progress;
};

export type NoteInput = {
  /** Create only: a client-chosen id (see src/ids.ts), so a note made offline keeps it. */
  id?: string;
  title?: string;
  body?: string;
  tags?: string[];
  pinned?: boolean;
  kind?: Kind;
};

export type ListQuery = {
  /** Full-text search words; the search operators are parsed before this (src/query.ts). */
  q?: string;
  kind?: string;
  /** `human`, `agent` (anyone else), or an author's name. */
  author?: string;
  /** Notes must carry every one of these. */
  tags?: string[];
  pinned?: boolean;
  limit?: number;
  offset?: number;
};

/**
 * A note's content as of `updated_at`. Saves by one author close together are one revision, so an
 * autosaving editor records an editing session rather than every pause in typing.
 */
export type Revision = {
  id: number;
  note_id: string;
  title: string;
  tags: string[];
  kind: Kind;
  /** Who made the change (X-Pad-Author), unlike the note's author, who created it. */
  author: string;
  updated_at: string;
  /** Lines added and removed since the previous revision. */
  added: number;
  removed: number;
};

export type FullRevision = Revision & { body: string };

/** A named search: `query` is what goes in the search box, operators included (src/query.ts). */
export type View = { id: string; name: string; query: string; created_at: string };

type Row = Omit<Note, "tags" | "pinned" | "progress"> & { tags: string; pinned: number };
type RevisionRow = Omit<FullRevision, "tags"> & { tags: string };

const toNote = (r: Row): Note => ({
  ...r,
  tags: JSON.parse(r.tags),
  pinned: !!r.pinned,
  progress: progress(r.body),
});

const toFullRevision = (r: RevisionRow): FullRevision => ({ ...r, tags: JSON.parse(r.tags) });
const toRevision = (r: RevisionRow): Revision => {
  const { body: _, ...rest } = toFullRevision(r);
  return rest;
};

const hasTag = "EXISTS (SELECT 1 FROM json_each(notes.tags) WHERE value = ?)";

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

export class Store {
  db: Database;
  private now: () => Date;

  constructor(path: string, { now = () => new Date() }: { now?: () => Date } = {}) {
    this.now = now;
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true, strict: true });
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run("PRAGMA foreign_keys = ON");
    migrate(this.db);
  }

  list({ q, kind, author, tags = [], pinned, limit = 50, offset = 0 }: ListQuery = {}): Note[] {
    const where: string[] = [];
    const params: Record<string, string | number> = { limit: Math.min(limit, 500), offset };
    let from = "notes n";
    if (q?.trim()) {
      from = "notes n JOIN notes_fts f ON f.rowid = n.rowid";
      where.push("notes_fts MATCH $q");
      // Quote each term so user input can't break FTS syntax; prefix-match the last one.
      const terms = q
        .trim()
        .split(/\s+/)
        .map((t) => `"${t.replace(/"/g, '""')}"`);
      terms[terms.length - 1] += "*";
      params.q = terms.join(" ");
    }
    if (kind) {
      where.push("n.kind = $kind");
      params.kind = kind;
    }
    if (author) {
      if (author.toLowerCase() === "agent") where.push("n.author <> 'human'");
      else {
        where.push("lower(n.author) = $author");
        params.author = author.toLowerCase();
      }
    }
    tags.forEach((tag, i) => {
      where.push(`EXISTS (SELECT 1 FROM json_each(n.tags) WHERE value = $tag${i})`);
      params[`tag${i}`] = tag.toLowerCase();
    });
    if (pinned !== undefined) {
      where.push("n.pinned = $pinned");
      params.pinned = pinned ? 1 : 0;
    }
    const sql = `SELECT n.* FROM ${from} ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY n.pinned DESC, n.updated_at DESC LIMIT $limit OFFSET $offset`;
    return (this.db.query(sql).all(params) as Row[]).map(toNote);
  }

  get(id: string): Note | null {
    const r = this.db.query("SELECT * FROM notes WHERE id = ?").get(id) as Row | null;
    return r ? toNote(r) : null;
  }

  create(input: NoteInput, author = "human"): Note {
    const now = this.now().toISOString();
    const body = input.body ?? "";
    const note: Note = {
      id: input.id ?? newId(),
      title: input.title?.trim() || deriveTitle(body),
      body,
      tags: normTags(input.tags),
      pinned: !!input.pinned,
      kind: input.kind ?? "note",
      author,
      created_at: now,
      updated_at: now,
      progress: progress(body),
    };
    const { progress: _, ...row } = note;
    this.db.transaction(() => {
      this.db
        .query(
          `INSERT INTO notes (id, title, body, tags, pinned, kind, author, created_at, updated_at)
           VALUES ($id, $title, $body, $tags, $pinned, $kind, $author, $created_at, $updated_at)`,
        )
        .run({ ...row, tags: JSON.stringify(note.tags), pinned: note.pinned ? 1 : 0 });
      this.record(note, author);
    })();
    return note;
  }

  /**
   * The daily review for `date` (a checked YYYY-MM-DD), created on first request with the open
   * items of the latest earlier review. One transaction, so two clients can't create it twice.
   */
  daily(date: string, author = "human"): { note: Note; created: boolean } {
    return this.db.transaction(() => {
      const title = dailyTitle(date);
      const existing = this.db
        .query(`SELECT * FROM notes WHERE title = ? AND ${hasTag}`)
        .get(title, DAILY_TAG) as Row | null;
      if (existing) return { note: toNote(existing), created: false };
      // ISO dates sort as text, so the latest earlier review is the greatest smaller title.
      const previous = this.db
        .query(
          `SELECT body FROM notes WHERE title LIKE ? AND title < ? AND ${hasTag}
           ORDER BY title DESC LIMIT 1`,
        )
        .get(`${dailyTitle("")}%`, title, DAILY_TAG) as { body: string } | null;
      const body = dailyBody(previous ? openItems(previous.body) : []);
      return { note: this.create({ title, body, tags: [DAILY_TAG] }, author), created: true };
    })();
  }

  update(id: string, patch: NoteInput, author = "human"): Note | null {
    const cur = this.get(id);
    if (!cur) return null;
    const next: Note = {
      ...cur,
      title:
        patch.title !== undefined
          ? patch.title.trim() || deriveTitle(patch.body ?? cur.body)
          : cur.title,
      body: patch.body ?? cur.body,
      tags: patch.tags !== undefined ? normTags(patch.tags) : cur.tags,
      pinned: patch.pinned ?? cur.pinned,
      kind: patch.kind ?? cur.kind,
      // Always later than the last write, even within one millisecond: updated_at is the version
      // clients send back in If-Match, so two writes must never share one.
      updated_at: new Date(
        Math.max(this.now().getTime(), Date.parse(cur.updated_at) + 1),
      ).toISOString(),
      progress: progress(patch.body ?? cur.body),
    };
    this.db.transaction(() => {
      this.db
        .query(
          `UPDATE notes SET title=$title, body=$body, tags=$tags, pinned=$pinned, kind=$kind, updated_at=$updated_at WHERE id=$id`,
        )
        .run({
          id,
          title: next.title,
          body: next.body,
          tags: JSON.stringify(next.tags),
          pinned: next.pinned ? 1 : 0,
          kind: next.kind,
          updated_at: next.updated_at,
        });
      if (!sameContent(cur, next)) this.record(next, author);
    })();
    return next;
  }

  append(id: string, text: string, author = "human"): Note | null {
    const cur = this.get(id);
    if (!cur) return null;
    const sep = cur.body && !cur.body.endsWith("\n") ? "\n" : "";
    return this.update(id, { body: cur.body + sep + text }, author);
  }

  /**
   * Adds `note`'s content to its history, or folds it into the latest revision when the same
   * author saved within the window. A folded revision that ends up equal to the one before it
   * (an edit typed and then undone) is dropped.
   */
  private record(note: Note, author: string) {
    const [last, before] = this.db
      .query("SELECT * FROM note_revisions WHERE note_id = ? ORDER BY id DESC LIMIT 2")
      .all(note.id) as RevisionRow[];
    const fold =
      last?.author === author &&
      Date.parse(note.updated_at) - Date.parse(last.updated_at) < REVISION_WINDOW_MS;
    const previous = fold ? before : last;
    if (fold && previous && sameContent(toFullRevision(previous), note)) {
      this.db.query("DELETE FROM note_revisions WHERE id = ?").run(last.id);
      return;
    }
    const row = {
      title: note.title,
      body: note.body,
      tags: JSON.stringify(note.tags),
      kind: note.kind,
      updated_at: note.updated_at,
      ...diffStats(previous?.body ?? "", note.body),
    };
    if (fold) {
      this.db
        .query(
          `UPDATE note_revisions SET title=$title, body=$body, tags=$tags, kind=$kind,
             updated_at=$updated_at, added=$added, removed=$removed WHERE id=$id`,
        )
        .run({ ...row, id: last.id });
    } else {
      this.db
        .query(
          `INSERT INTO note_revisions (note_id, title, body, tags, kind, author, updated_at, added, removed)
           VALUES ($note_id, $title, $body, $tags, $kind, $author, $updated_at, $added, $removed)`,
        )
        .run({ ...row, note_id: note.id, author });
    }
  }

  /** A note's history, newest first, without bodies. */
  revisions(noteId: string, { limit = 50, offset = 0 } = {}): Revision[] {
    return (
      this.db
        .query("SELECT * FROM note_revisions WHERE note_id = ? ORDER BY id DESC LIMIT ? OFFSET ?")
        .all(noteId, Math.min(limit, 500), offset) as RevisionRow[]
    ).map(toRevision);
  }

  revision(noteId: string, id: number): FullRevision | null {
    const r = this.db
      .query("SELECT * FROM note_revisions WHERE note_id = ? AND id = ?")
      .get(noteId, id) as RevisionRow | null;
    return r ? toFullRevision(r) : null;
  }

  /** The revision just before `id`, or null when `id` is the first. */
  previousRevision(noteId: string, id: number): FullRevision | null {
    const r = this.db
      .query("SELECT * FROM note_revisions WHERE note_id = ? AND id < ? ORDER BY id DESC LIMIT 1")
      .get(noteId, id) as RevisionRow | null;
    return r ? toFullRevision(r) : null;
  }

  /** The latest revision, or the latest saved at or before `until` (an ISO timestamp). */
  latestRevision(noteId: string, until?: string): FullRevision | null {
    const r = this.db
      .query(
        `SELECT * FROM note_revisions WHERE note_id = $id AND ($until IS NULL OR updated_at <= $until)
         ORDER BY id DESC LIMIT 1`,
      )
      .get({ id: noteId, until: until ?? null }) as RevisionRow | null;
    return r ? toFullRevision(r) : null;
  }

  delete(id: string): boolean {
    return this.db.query("DELETE FROM notes WHERE id = ?").run(id).changes > 0;
  }

  tags(): { tag: string; count: number }[] {
    return this.db
      .query(
        `SELECT value AS tag, COUNT(*) AS count FROM notes, json_each(notes.tags)
         GROUP BY value ORDER BY count DESC, tag`,
      )
      .all() as { tag: string; count: number }[];
  }

  views(): View[] {
    return this.db.query("SELECT * FROM views ORDER BY name").all() as View[];
  }

  /** Null when a view with this name (ignoring case) exists already. */
  createView(name: string, query: string): View | null {
    const view: View = { id: newId(), name, query, created_at: this.now().toISOString() };
    try {
      this.db
        .query(
          "INSERT INTO views (id, name, query, created_at) VALUES ($id, $name, $query, $created_at)",
        )
        .run(view);
    } catch (e) {
      if (e instanceof Error && e.message.includes("UNIQUE")) return null;
      throw e;
    }
    return view;
  }

  deleteView(id: string): boolean {
    return this.db.query("DELETE FROM views WHERE id = ?").run(id).changes > 0;
  }
}
