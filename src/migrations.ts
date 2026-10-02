import type { Database } from "bun:sqlite";

/**
 * One schema change, identified by a permanent name and recorded in `schema_migrations` once
 * applied. Append new ones to the end of the list; never edit or reorder one that has shipped.
 */
export type Migration = { id: string; statements: string[] };

export const MIGRATIONS: Migration[] = [
  {
    // `IF NOT EXISTS` on the first two only: databases created before this bookkeeping already
    // have these tables, and must adopt them rather than fail. Nothing after this needs it.
    id: "0001.notes",
    statements: [
      `CREATE TABLE IF NOT EXISTS notes (
         id TEXT PRIMARY KEY,
         title TEXT NOT NULL,
         body TEXT NOT NULL DEFAULT '',
         tags TEXT NOT NULL DEFAULT '[]',
         pinned INTEGER NOT NULL DEFAULT 0,
         author TEXT NOT NULL DEFAULT 'human',
         created_at TEXT NOT NULL,
         updated_at TEXT NOT NULL
       )`,
    ],
  },
  {
    id: "0002.notes_fts",
    statements: [
      `CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
         title, body, tags, content='notes', content_rowid='rowid'
       )`,
      `CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
         INSERT INTO notes_fts(rowid, title, body, tags) VALUES (new.rowid, new.title, new.body, new.tags);
       END`,
      `CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
         INSERT INTO notes_fts(notes_fts, rowid, title, body, tags) VALUES ('delete', old.rowid, old.title, old.body, old.tags);
       END`,
      `CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
         INSERT INTO notes_fts(notes_fts, rowid, title, body, tags) VALUES ('delete', old.rowid, old.title, old.body, old.tags);
         INSERT INTO notes_fts(rowid, title, body, tags) VALUES (new.rowid, new.title, new.body, new.tags);
       END`,
    ],
  },
  {
    // Matches the list order: pinned first, then most recently updated.
    id: "0003.notes_order_index",
    statements: ["CREATE INDEX notes_order ON notes(pinned DESC, updated_at DESC)"],
  },
  {
    // Notes were already classified by hand with tags; those tags stay, the kind is read from them.
    id: "0004.notes_kind",
    statements: [
      "ALTER TABLE notes ADD COLUMN kind TEXT NOT NULL DEFAULT 'note'",
      `UPDATE notes SET kind = 'reference' WHERE EXISTS (
         SELECT 1 FROM json_each(notes.tags) WHERE value IN ('checklist', 'principles')
       )`,
    ],
  },
  {
    // Each existing note starts its history with its current state, so the first edit after this
    // has something to be diffed against. Its lines count as added, like a newly created note's.
    id: "0005.note_revisions",
    statements: [
      `CREATE TABLE note_revisions (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
         title TEXT NOT NULL,
         body TEXT NOT NULL,
         tags TEXT NOT NULL,
         kind TEXT NOT NULL,
         author TEXT NOT NULL,
         updated_at TEXT NOT NULL,
         added INTEGER NOT NULL DEFAULT 0,
         removed INTEGER NOT NULL DEFAULT 0
       )`,
      "CREATE INDEX note_revisions_note ON note_revisions(note_id, id)",
      `INSERT INTO note_revisions (note_id, title, body, tags, kind, author, updated_at, added)
       SELECT id, title, body, tags, kind, author, updated_at,
              CASE WHEN body = '' THEN 0 ELSE length(body) - length(replace(body, char(10), '')) + 1 END
       FROM notes ORDER BY created_at`,
    ],
  },
  {
    // A saved search. The name is unique ignoring case, so two views can't differ only by it.
    id: "0006.views",
    statements: [
      `CREATE TABLE views (
         id TEXT PRIMARY KEY,
         name TEXT NOT NULL COLLATE NOCASE UNIQUE,
         query TEXT NOT NULL,
         created_at TEXT NOT NULL
       )`,
    ],
  },
  {
    // Pinning was never used. The column goes, and the list order keeps only its recency half.
    // The index has to go first: SQLite refuses to drop a column an index still uses.
    id: "0007.drop_pinned",
    statements: [
      "DROP INDEX notes_order",
      "ALTER TABLE notes DROP COLUMN pinned",
      "CREATE INDEX notes_order ON notes(updated_at DESC)",
    ],
  },
];

/** Applies every migration not yet recorded, all in one transaction. Returns the ids it ran. */
export function migrate(db: Database, migrations: Migration[] = MIGRATIONS): string[] {
  db.run(`CREATE TABLE IF NOT EXISTS schema_migrations (
            id TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL
          )`);
  const applied = new Set(
    db
      .query<{ id: string }, []>("SELECT id FROM schema_migrations")
      .all()
      .map((row) => row.id),
  );
  const pending = migrations.filter((m) => !applied.has(m.id));

  db.transaction(() => {
    for (const migration of pending) {
      for (const statement of migration.statements) db.run(statement);
      // Positional parameters: named ones depend on how the caller opened the database.
      db.query("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(
        migration.id,
        new Date().toISOString(),
      );
    }
  })();

  return pending.map((m) => m.id);
}
