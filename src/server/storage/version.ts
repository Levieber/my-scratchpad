// A cheap answer to "has anything changed since I last looked?", for clients that poll.
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";

import { run } from "./sql";

export const makeVersion = (sql: SqlClient.SqlClient) => {
  // total_changes() restarts from zero with each connection, so on its own a restart would
  // repeat a version that already meant other data.
  const boot = crypto.randomUUID().slice(0, 8);

  return {
    /**
     * Changes whenever the database does, without reading any of it: the store's one connection
     * counts every row written (triggers included), and data_version moves when another process
     * writes the file, which nobody should but nothing prevents. A rolled-back write may count
     * too: that only costs a client one answer in full.
     */
    version: run(
      Effect.gen(function* () {
        const changes = yield* sql<{ n: number }>`SELECT total_changes() AS n`;
        const file = yield* sql<{ n: number }>`SELECT data_version AS n FROM pragma_data_version`;
        return `${boot}-${changes[0]?.n}-${file[0]?.n}`;
      }),
    ),
  };
};
