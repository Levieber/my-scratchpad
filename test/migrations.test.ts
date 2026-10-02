import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { Store } from "../src/db";
import { MIGRATIONS, migrate } from "../src/migrations";

const ids = MIGRATIONS.map((m) => m.id);
const applied = (db: Database) =>
  db
    .query<{ id: string }, []>("SELECT id FROM schema_migrations ORDER BY id")
    .all()
    .map((r) => r.id);

describe("migrations", () => {
  test("a fresh database runs every migration once", () => {
    const db = new Database(":memory:");
    expect(migrate(db)).toEqual(ids);
    expect(migrate(db)).toEqual([]);
    expect(applied(db)).toEqual(ids);
  });

  test("ids are unique", () => {
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("a database from before schema_migrations is adopted, keeping its notes", () => {
    // The schema the app created before named migrations existed (tables + FTS, no index).
    const db = new Database(":memory:");
    for (const m of MIGRATIONS.slice(0, 2)) for (const s of m.statements) db.run(s);
    db.run(
      `INSERT INTO notes (id, title, body, created_at, updated_at) VALUES ('old', 'Old note', 'still searchable', 'x', 'x')`,
    );

    expect(migrate(db)).toEqual(ids);
    expect(db.query("SELECT COUNT(*) AS n FROM notes").get()).toEqual({ n: 1 });
    const index = db
      .query("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'notes_order'")
      .get();
    expect(index).toEqual({ name: "notes_order" });
  });

  test("0004 marks checklist and principles notes as reference, keeping their tags", () => {
    const db = new Database(":memory:");
    migrate(
      db,
      MIGRATIONS.filter((m) => m.id < "0004"),
    );
    const insert = db.query(
      "INSERT INTO notes (id, title, tags, created_at, updated_at) VALUES (?, ?, ?, 'x', 'x')",
    );
    insert.run("c", "SEO checklist", '["seo","checklist"]');
    insert.run("p", "Working principles", '["principles","agents"]');
    insert.run("t", "Tasks", '["tasks"]');

    migrate(db);
    const rows = db.query("SELECT id, kind, tags FROM notes ORDER BY id").all();
    expect(rows).toEqual([
      { id: "c", kind: "reference", tags: '["seo","checklist"]' },
      { id: "p", kind: "reference", tags: '["principles","agents"]' },
      { id: "t", kind: "note", tags: '["tasks"]' },
    ]);
  });

  test("0005 starts every note's history with its current state", () => {
    const db = new Database(":memory:");
    migrate(
      db,
      MIGRATIONS.filter((m) => m.id < "0005"),
    );
    const insert = db.query(
      "INSERT INTO notes (id, title, body, author, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    );
    insert.run("a", "Log", "one\ntwo\nthree", "claude-code", "2026-01-01", "2026-01-02");
    insert.run("b", "Empty", "", "human", "2026-01-03", "2026-01-03");

    migrate(db);
    const rows = db
      .query(
        "SELECT note_id, body, author, updated_at, added, removed FROM note_revisions ORDER BY id",
      )
      .all();
    expect(rows).toEqual([
      {
        note_id: "a",
        body: "one\ntwo\nthree",
        author: "claude-code",
        updated_at: "2026-01-02",
        added: 3,
        removed: 0,
      },
      { note_id: "b", body: "", author: "human", updated_at: "2026-01-03", added: 0, removed: 0 },
    ]);
  });

  test("0007 drops the pinned column and keeps the notes, newest first", () => {
    const db = new Database(":memory:");
    migrate(
      db,
      MIGRATIONS.filter((m) => m.id < "0007"),
    );
    db.query(
      "INSERT INTO notes (id, title, body, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("a", "Pinned old", "x", 1, "2026-01-01", "2026-01-01");
    db.query(
      "INSERT INTO notes (id, title, body, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("b", "Newer", "y", 0, "2026-01-02", "2026-01-02");

    migrate(db);
    const columns = db.query("PRAGMA table_info(notes)").all() as { name: string }[];
    expect(columns.map((c) => c.name)).not.toContain("pinned");
    const ids = db.query("SELECT id FROM notes ORDER BY updated_at DESC").all();
    expect(ids).toEqual([{ id: "b" }, { id: "a" }]);
    // The search index still follows writes after the table was altered.
    db.query("UPDATE notes SET body = 'findme' WHERE id = 'a'").run();
    expect(
      db.query("SELECT rowid FROM notes_fts WHERE notes_fts MATCH 'findme'").all(),
    ).toHaveLength(1);
  });

  test("a failing migration rolls back the whole batch", () => {
    const db = new Database(":memory:");
    const broken = [
      ...MIGRATIONS,
      { id: "9999.broken", statements: ["CREATE TABLE nope (", "SELECT 1"] },
    ];
    expect(() => migrate(db, broken)).toThrow();
    expect(db.query("SELECT name FROM sqlite_master WHERE name = 'notes'").get()).toBeNull();
  });

  test("Store applies migrations on open", () => {
    const store = new Store(":memory:");
    expect(applied(store.db)).toEqual(ids);
  });
});
