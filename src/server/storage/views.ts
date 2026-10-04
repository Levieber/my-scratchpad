// Saved searches.
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as SqlClient from "effect/sql/SqlClient";

import type { ArchiveView } from "@/shared/archive";
import { View } from "@/shared/domain";
import { newId } from "@/shared/ids";

import { ViewExists, ViewNotFound } from "./errors";
import { nowIso, run } from "./sql";

export const makeViews = (sql: SqlClient.SqlClient) => ({
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

  /**
   * A view from an export, with the id and date it had. A name already taken is left alone
   * ("skipped"); an id already taken by another view is replaced by a new one.
   */
  importView: (view: ArchiveView) =>
    run(
      Effect.gen(function* () {
        const name = view.name.trim().slice(0, 64);
        if ((yield* sql`SELECT 1 FROM views WHERE name = ${name}`).length) return "skipped";
        const idTaken = view.id
          ? (yield* sql`SELECT 1 FROM views WHERE id = ${view.id}`).length > 0
          : true;
        const row: View = {
          id: view.id && !idTaken ? view.id : newId(),
          name,
          query: view.query.trim(),
          created_at: view.created_at ?? (yield* nowIso),
        };
        yield* sql`INSERT INTO views ${sql.insert(row)}`;
        return "created";
      }).pipe(sql.withTransaction),
    ),

  deleteView: (id: string) =>
    run(
      Effect.flatMap(sql`DELETE FROM views WHERE id = ${id} RETURNING id`, (rows) =>
        rows.length ? Effect.void : Effect.fail(new ViewNotFound({ id })),
      ),
    ),
});
