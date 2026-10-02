// What every query module shares: SQL failures as defects, and the clock as an ISO timestamp.
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as SqlError from "effect/sql/SqlError";

// SQL failures are defects here: the server answers them with `internal`, and no caller can
// do anything better with them. Domain outcomes (not found, exists, changed) stay typed.
export const run = <A, E>(
  effect: Effect.Effect<A, E | SqlError.SqlError>,
): Effect.Effect<A, Exclude<E, SqlError.SqlError>> =>
  Effect.catchIf(effect, SqlError.isSqlError, Effect.die, Effect.fail);

export const nowIso = Effect.map(Clock.currentTimeMillis, (ms) => new Date(ms).toISOString());
