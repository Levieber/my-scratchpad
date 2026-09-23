import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { migrate } from "./migrations";

export type Note = {
  id: string;
  title: string;
  body: string;
  tags: string[];
  pinned: boolean;
  author: string;
  created_at: string;
  updated_at: string;
};

export type NoteInput = {
  title?: string;
  body?: string;
  tags?: string[];
  pinned?: boolean;
};

export type ListQuery = {
  q?: string;
  tag?: string;
  pinned?: boolean;
  limit?: number;
  offset?: number;
};

type Row = Omit<Note, "tags" | "pinned"> & { tags: string; pinned: number };

const toNote = (r: Row): Note => ({ ...r, tags: JSON.parse(r.tags), pinned: !!r.pinned });

// Sortable, URL-safe id: base36 timestamp + random suffix.
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const normTags = (tags: unknown): string[] =>
  Array.isArray(tags)
    ? [...new Set(tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean))]
    : [];

// Derive a title from the first non-empty line when none is given.
const deriveTitle = (body: string) =>
  (body.split("\n").find((l) => l.trim()) ?? "")
    .replace(/^#+\s*/, "")
    .trim()
    .slice(0, 80) || "Untitled";

export class Store {
  db: Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true, strict: true });
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run("PRAGMA foreign_keys = ON");
    migrate(this.db);
  }

  list({ q, tag, pinned, limit = 50, offset = 0 }: ListQuery = {}): Note[] {
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
    if (tag) {
      where.push("EXISTS (SELECT 1 FROM json_each(n.tags) WHERE value = $tag)");
      params.tag = tag.toLowerCase();
    }
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
    const now = new Date().toISOString();
    const body = input.body ?? "";
    const note: Note = {
      id: newId(),
      title: input.title?.trim() || deriveTitle(body),
      body,
      tags: normTags(input.tags),
      pinned: !!input.pinned,
      author,
      created_at: now,
      updated_at: now,
    };
    this.db
      .query(
        `INSERT INTO notes (id, title, body, tags, pinned, author, created_at, updated_at)
         VALUES ($id, $title, $body, $tags, $pinned, $author, $created_at, $updated_at)`,
      )
      .run({ ...note, tags: JSON.stringify(note.tags), pinned: note.pinned ? 1 : 0 });
    return note;
  }

  update(id: string, patch: NoteInput): Note | null {
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
      updated_at: new Date().toISOString(),
    };
    this.db
      .query(
        `UPDATE notes SET title=$title, body=$body, tags=$tags, pinned=$pinned, updated_at=$updated_at WHERE id=$id`,
      )
      .run({
        id,
        title: next.title,
        body: next.body,
        tags: JSON.stringify(next.tags),
        pinned: next.pinned ? 1 : 0,
        updated_at: next.updated_at,
      });
    return next;
  }

  append(id: string, text: string): Note | null {
    const cur = this.get(id);
    if (!cur) return null;
    const sep = cur.body && !cur.body.endsWith("\n") ? "\n" : "";
    return this.update(id, { body: cur.body + sep + text });
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
}
