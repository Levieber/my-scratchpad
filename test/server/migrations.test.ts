import { describe, expect, test } from "bun:test";

import * as SqliteClient from "@effect/sql-sqlite-bun/SqliteClient";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as SqlClient from "effect/sql/SqlClient";

import { MIGRATIONS, migrate, migrateWith } from "@/server/storage/migrations";
import { sqlite } from "@/server/storage/sqlite";

const ids = MIGRATIONS.map((m) => m.id);

// Each test gets a fresh, empty database; `sql` is its client.
const onFreshDb = <A, E>(
  f: (sql: SqlClient.SqlClient) => Effect.Effect<A, E, SqlClient.SqlClient>,
) =>
  Effect.runPromise(
    Effect.flatMap(SqlClient.SqlClient, f).pipe(
      Effect.provide(SqliteClient.layer({ filename: ":memory:" })),
    ),
  );

const applied = (sql: SqlClient.SqlClient) =>
  Effect.map(sql<{ id: string }>`SELECT id FROM schema_migrations ORDER BY id`, (rows) =>
    rows.map((r) => r.id),
  );

const before = (id: string) => migrateWith(MIGRATIONS.filter((m) => m.id < id));

describe("migrations", () => {
  test("a fresh database runs every migration once", async () => {
    const [first, second, recorded] = await onFreshDb((sql) =>
      Effect.all([migrate, migrate, applied(sql)]),
    );
    expect(first).toEqual(ids);
    expect(second).toEqual([]);
    expect(recorded).toEqual(ids);
  });

  test("ids are unique", () => {
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("a database from before schema_migrations is adopted, keeping its notes", async () => {
    // The schema the app created before named migrations existed (tables + FTS, no index).
    const [ran, count, index] = await onFreshDb((sql) =>
      Effect.gen(function* () {
        for (const m of MIGRATIONS.slice(0, 2)) for (const s of m.statements) yield* sql.unsafe(s);
        yield* sql`INSERT INTO notes (id, title, body, created_at, updated_at)
                   VALUES ('old', 'Old note', 'still searchable', 'x', 'x')`;
        return [
          yield* migrate,
          yield* sql`SELECT COUNT(*) AS n FROM notes`,
          yield* sql`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'notes_order'`,
        ] as const;
      }),
    );
    expect(ran).toEqual(ids);
    expect(count).toEqual([{ n: 1 }]);
    expect(index).toEqual([{ name: "notes_order" }]);
  });

  test("0004 marks checklist and principles notes as reference, keeping their tags", async () => {
    const rows = await onFreshDb((sql) =>
      Effect.gen(function* () {
        yield* before("0004");
        const insert = (id: string, title: string, tags: string) =>
          sql`INSERT INTO notes (id, title, tags, created_at, updated_at)
              VALUES (${id}, ${title}, ${tags}, 'x', 'x')`;
        yield* insert("c", "SEO checklist", '["seo","checklist"]');
        yield* insert("p", "Working principles", '["principles","agents"]');
        yield* insert("t", "Tasks", '["tasks"]');
        yield* migrate;
        return yield* sql`SELECT id, kind, tags FROM notes ORDER BY id`;
      }),
    );
    expect(rows).toEqual([
      { id: "c", kind: "reference", tags: '["seo","checklist"]' },
      { id: "p", kind: "reference", tags: '["principles","agents"]' },
      { id: "t", kind: "note", tags: '["tasks"]' },
    ]);
  });

  test("0005 starts every note's history with its current state", async () => {
    const rows = await onFreshDb((sql) =>
      Effect.gen(function* () {
        yield* before("0005");
        const insert = (...[id, title, body, author, created, updated]: string[]) =>
          sql`INSERT INTO notes (id, title, body, author, created_at, updated_at)
              VALUES (${id}, ${title}, ${body}, ${author}, ${created}, ${updated})`;
        yield* insert("a", "Log", "one\ntwo\nthree", "claude-code", "2026-01-01", "2026-01-02");
        yield* insert("b", "Empty", "", "human", "2026-01-03", "2026-01-03");
        yield* migrate;
        return yield* sql`SELECT note_id, body, author, updated_at, added, removed
                          FROM note_revisions ORDER BY id`;
      }),
    );
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

  test("0007 drops the pinned column and keeps the notes, newest first", async () => {
    const [columns, order, found] = await onFreshDb((sql) =>
      Effect.gen(function* () {
        yield* before("0007");
        yield* sql`INSERT INTO notes (id, title, body, pinned, created_at, updated_at)
                   VALUES ('a', 'Pinned old', 'x', 1, '2026-01-01', '2026-01-01')`;
        yield* sql`INSERT INTO notes (id, title, body, pinned, created_at, updated_at)
                   VALUES ('b', 'Newer', 'y', 0, '2026-01-02', '2026-01-02')`;
        yield* migrate;
        const columns = yield* sql<{ name: string }>`PRAGMA table_info(notes)`;
        const order = yield* sql`SELECT id FROM notes ORDER BY updated_at DESC`;
        // The search index still follows writes after the table was altered.
        yield* sql`UPDATE notes SET body = 'findme' WHERE id = 'a'`;
        const found = yield* sql`SELECT rowid FROM notes_fts WHERE notes_fts MATCH 'findme'`;
        return [columns.map((c) => c.name), order, found] as const;
      }),
    );
    expect(columns).not.toContain("pinned");
    expect(order).toEqual([{ id: "b" }, { id: "a" }]);
    expect(found).toHaveLength(1);
  });

  test("a failing migration rolls back the whole batch", async () => {
    const broken = [
      ...MIGRATIONS,
      { id: "9999.broken", statements: ["CREATE TABLE nope (", "SELECT 1"] },
    ];
    const [exit, notes] = await onFreshDb((sql) =>
      Effect.all([
        Effect.exit(migrateWith(broken)),
        sql`SELECT name FROM sqlite_master WHERE name = 'notes'`,
      ]),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(notes).toEqual([]);
  });

  test("the store's database is migrated before it is handed out", async () => {
    const recorded = await Effect.runPromise(
      Effect.flatMap(SqlClient.SqlClient, applied).pipe(Effect.provide(sqlite(":memory:"))),
    );
    expect(recorded).toEqual(ids);
  });
});
