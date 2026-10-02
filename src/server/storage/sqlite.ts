// The database file: opened, with the pragmas the schema relies on, and migrated.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import * as SqliteClient from "@effect/sql-sqlite-bun/SqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import { migrate } from "./migrations";

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
