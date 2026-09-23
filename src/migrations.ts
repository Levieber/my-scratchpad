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
