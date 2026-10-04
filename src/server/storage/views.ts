// Saved searches, each with the layout it is shown in.
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as SqlClient from "effect/sql/SqlClient";

import type { ArchiveView } from "@/shared/archive";
import { KnownViewOptions, type NewView, View, type ViewPatch } from "@/shared/domain";
import { newId } from "@/shared/ids";
import { isObject, mergePatch } from "@/shared/layouts";

import { InvalidViewOptions, ViewExists, ViewNotFound } from "./errors";
import { nowIso, run } from "./sql";

// Options are a JSON object in one column; the rest of a row is already the API's shape.
const ViewRow = Schema.Struct({
  ...View.fields,
  options: Schema.fromJsonString(View.fields.options),
});
const decodeView = (row: unknown) => Effect.orDie(Schema.decodeUnknownEffect(ViewRow)(row));

const checkKnown = Schema.decodeUnknownEffect(KnownViewOptions);

/**
 * `options` with `patch` merged in, when the options it touches read right. Only those: one a
 * newer app wrote in a way this version can't read mustn't stop an edit of anything else.
 */
const mergeOptions = (options: Record<string, unknown>, patch: Record<string, unknown>) =>
  Effect.gen(function* () {
    const merged = mergePatch(options, patch);
    if (!isObject(merged)) return yield* new InvalidViewOptions({ reason: "Expected an object" });
    const touched = Object.fromEntries(
      Object.keys(patch).flatMap((key) => (key in merged ? [[key, merged[key]]] : [])),
    );
    // Checked, but stored as merged: the decoded copy would drop the options this version lacks.
    yield* Effect.mapError(
      checkKnown(touched),
      (error) => new InvalidViewOptions({ reason: error.message }),
    );
    return merged;
  });

/** The options of an imported view that read right: a bad one is left out alone, like a bad item. */
const readableOptions = (options: Record<string, unknown>) =>
  Effect.filter(Object.entries(options), ([key, value]) =>
    Effect.isSuccess(checkKnown({ [key]: value })),
  ).pipe(Effect.map(Object.fromEntries<unknown>));

export const makeViews = (sql: SqlClient.SqlClient) => {
  const nameTaken = (name: string, except = "") =>
    Effect.map(
      sql`SELECT 1 FROM views WHERE name = ${name} AND id != ${except}`,
      (rows) => rows.length > 0,
    );

  return {
    views: run(
      Effect.flatMap(sql`SELECT * FROM views ORDER BY name`, (rows) =>
        Effect.forEach(rows, decodeView),
      ),
    ),

    /** Fails with ViewExists when a view with this name (ignoring case) exists already. */
    createView: (input: NewView) =>
      run(
        Effect.gen(function* () {
          const view: View = {
            id: newId(),
            name: input.name,
            query: input.query,
            layout: input.layout ?? null,
            options: yield* mergeOptions({}, input.options ?? {}),
            created_at: yield* nowIso,
          };
          if (yield* nameTaken(view.name)) return yield* new ViewExists({ name: view.name });
          yield* sql`INSERT INTO views ${sql.insert({ ...view, options: JSON.stringify(view.options) })}`;
          return view;
        }).pipe(sql.withTransaction),
      ),

    /** Changes only the fields in `patch`; its options merge into the view's (mergePatch). */
    updateView: (id: string, patch: ViewPatch) =>
      run(
        Effect.gen(function* () {
          const [row] = yield* sql`SELECT * FROM views WHERE id = ${id}`;
          if (!row) return yield* new ViewNotFound({ id });
          const current = yield* decodeView(row);
          const view: View = {
            ...current,
            ...(patch.name !== undefined && { name: patch.name }),
            ...(patch.query !== undefined && { query: patch.query }),
            ...(patch.layout !== undefined && { layout: patch.layout }),
            options: yield* mergeOptions(current.options, patch.options ?? {}),
          };
          if (view.name !== current.name && (yield* nameTaken(view.name, id)))
            return yield* new ViewExists({ name: view.name });
          yield* sql`UPDATE views SET ${sql.update({
            name: view.name,
            query: view.query,
            layout: view.layout,
            options: JSON.stringify(view.options),
          })} WHERE id = ${id}`;
          return view;
        }).pipe(sql.withTransaction),
      ),

    /**
     * A view from an export, with the id and date it had. A name already taken is left alone
     * ("skipped"); an id already taken by another view is replaced by a new one. A layout this
     * server doesn't know is kept, as a newer one wrote it: clients show it as the list.
     */
    importView: (view: ArchiveView) =>
      run(
        Effect.gen(function* () {
          const name = view.name.trim().slice(0, 64);
          if (yield* nameTaken(name)) return "skipped";
          const idTaken = view.id
            ? (yield* sql`SELECT 1 FROM views WHERE id = ${view.id}`).length > 0
            : true;
          const row: View = {
            id: view.id && !idTaken ? view.id : newId(),
            name,
            query: view.query.trim(),
            layout: view.layout ?? null,
            options: yield* readableOptions(view.options ?? {}),
            created_at: view.created_at ?? (yield* nowIso),
          };
          yield* sql`INSERT INTO views ${sql.insert({ ...row, options: JSON.stringify(row.options) })}`;
          return "created";
        }).pipe(sql.withTransaction),
      ),

    deleteView: (id: string) =>
      run(
        Effect.flatMap(sql`DELETE FROM views WHERE id = ${id} RETURNING id`, (rows) =>
          rows.length ? Effect.void : Effect.fail(new ViewNotFound({ id })),
        ),
      ),
  };
};
