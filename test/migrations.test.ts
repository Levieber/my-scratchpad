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
