// What a hook shows an agent, as a client fetches it: from the server's selections, or, from a
// server older than them, the way hooks worked before (this machine's search, else the default).
import * as Effect from "effect/Effect";

import type { HookSection } from "@/shared/domain";
import { HOOKS, type HookName, type Location } from "@/shared/hooks";

import { type ApiError, Client } from "./client";

/** `override` is this machine's own search for everywhere (`pad hooks set --local`). */
export const hookSections = Effect.fnUntraced(function* (
  name: HookName,
  at: Location,
  override: string | undefined,
) {
  const client = yield* Client;
  const { query, limit } = HOOKS[name];
  return yield* Effect.catchIf(
    Effect.map(client.hookNotes(name, at, override), (r) => r.sections),
    // An unknown path, not an unknown hook: the server predates hook selections.
    (e: ApiError) => e.code === "notFound",
    () =>
      Effect.map(client.list({ q: override ?? query, limit }), (notes): HookSection[] => [
        {
          scope: "",
          query: override ?? query,
          source: override ? "machine" : "default",
          limit,
          include: [],
          notes,
        },
      ]),
    Effect.fail,
  );
});
