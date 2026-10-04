// The app's one editor session, on the outbox and syncer of this browser (storage.ts).
import { newId } from "@/shared/ids";
import { EditorSession } from "@/web/lib/editor-session";
import { needsToken } from "@/web/lib/failures";
import { outbox, syncer } from "@/web/lib/storage";
import type { SyncResult } from "@/web/lib/sync";

const synced = new Set<(result: SyncResult) => void>();

/** After each sync run, e.g. to refresh what the server now has. */
export function onSynced(fn: (result: SyncResult) => void) {
  synced.add(fn);
  return () => void synced.delete(fn);
}

export const session = new EditorSession({
  outbox,
  syncer,
  newId,
  onSynced: (result) => {
    if (result.status === "unauthorized") needsToken.set(true);
    synced.forEach((fn) => fn(result));
  },
});
