import { useMemo, useSyncExternalStore } from "react";

import { outbox } from "@/web/lib/storage";

/** Edits and deletes the server doesn't have yet (lib/sync.ts). */
export const usePending = () => useSyncExternalStore(outbox.subscribe, outbox.all);

/** Notes made here that the server hasn't seen: it has no history, pins or picks for them. */
export function useUnsyncedIds() {
  const pending = usePending();
  return useMemo(
    () => new Set(pending.flatMap((p) => (p.op === "save" && !p.base ? [p.id] : []))),
    [pending],
  );
}
