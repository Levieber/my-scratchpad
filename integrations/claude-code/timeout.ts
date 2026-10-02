import * as Effect from "effect/Effect";

/**
 * Hooks run on every session or turn, so a slow or unreachable server must not hold Claude up:
 * past the timeout, or on any failure at all, the hook does nothing.
 */
export const quietly = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.timeout("1500 millis"), Effect.ignoreCause);
