import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlError from "effect/sql/SqlError";

import { DatabaseUnavailable } from "./errors";
import { makeNotes } from "./notes";
import { makePins } from "./pins";
import { makeRevisions } from "./revisions";
import { sqlite } from "./sqlite";
import { makeViews } from "./views";

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const { record, ...history } = makeRevisions(sql);

  return {
    ...makeNotes(sql, record),
    ...history,
    ...makeViews(sql),
    ...makePins(sql),

    /**
     * Reads a row of the notes table: fails when the file can't be read at all, not just when a
     * query is wrong. The one SQL failure that is an outcome instead of a defect, since the
     * health check exists to report it.
     */
    ping: Effect.catchIf(sql`SELECT 1 FROM notes LIMIT 1`, SqlError.isSqlError, (cause) =>
      Effect.fail(new DatabaseUnavailable({ cause })),
    ).pipe(Effect.asVoid),
  };
});

/** Notes, saved views and pins in SQLite + FTS5. Only the server uses it. */
export class Store extends Context.Service<Store, Effect.Success<typeof make>>()("pad/Store") {
  /** On whatever SqlClient is provided; the database must already be migrated. */
  static readonly layerNoDeps = Layer.effect(Store, make);

  /** On a SQLite file (or `:memory:`), migrated before the store is handed out. */
  static readonly layer = (filename: string) =>
    Store.layerNoDeps.pipe(Layer.provideMerge(sqlite(filename)));
}
