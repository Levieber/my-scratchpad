import { skipToken, useQuery } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";

import { bodyRef } from "@/web/hooks/focus";
import { listedNote } from "@/web/hooks/notes.hook";
import { useUnsyncedIds } from "@/web/hooks/pending.hook";
import { api, isApiError, type Note, Unauthorized } from "@/web/lib/api";
import { handle } from "@/web/lib/failures";
import { localNote } from "@/web/lib/pending";
import { keys, POLL_MS, queryClient } from "@/web/lib/queries";
import { session } from "@/web/lib/session";
import { outbox } from "@/web/lib/storage";
import { Store } from "@/web/lib/store";

/** The open note and its form, as the editor session has them (lib/editor-session.ts). */
export const useEditor = () => useSyncExternalStore(session.subscribe, session.getSnapshot);

/** Opens a note from the server; offline, or made here and not synced yet, from what this device has. */
export const openNote = (id: string) =>
  session
    .open(async () => {
      try {
        return await queryClient.query({
          queryKey: keys.note(id),
          queryFn: () => api.get(id),
          retry: false,
        });
      } catch (e) {
        const p = outbox.get(id);
        const known = listedNote(id) ?? (p?.op === "save" ? localNote(id, p.fields) : undefined);
        if (known && !(e instanceof Unauthorized)) return known;
        throw e;
      }
    })
    .catch(handle);

/** The note waiting for the person to confirm its deletion (delete-dialog.tsx). */
export const deleting = new Store<Note | null>(null);

/**
 * Deletes a note from the list, or the open one, once the person confirms. A new note never
 * saved has nothing to lose: it goes at once.
 */
export function removeNote(note?: Note) {
  const target = note ?? session.getSnapshot().current;
  if (target) deleting.set(target);
  else session.remove();
}

/**
 * Keeps the open note current while it is shown: a write elsewhere (an agent, the CLI) comes in,
 * unless the person is in the body, where the text would change under the cursor. The session
 * takes only a version newer than its own (EditorSession.receive).
 */
export function useLiveOpenNote() {
  const { current } = useEditor();
  const unsynced = useUnsyncedIds();
  const id = current && !unsynced.has(current.id) ? current.id : null;
  const { data, dataUpdatedAt } = useQuery({
    queryKey: keys.note(id ?? ""),
    // Deleted elsewhere: nothing comes in; the editor keeps what it shows.
    queryFn: id
      ? () =>
          api.get(id).catch((e: unknown) => {
            if (isApiError(e, "noteNotFound")) return null;
            throw e;
          })
      : skipToken,
    refetchInterval: POLL_MS,
  });
  // Every answer, not only a changed one: one skipped while the person typed applies after.
  useEffect(() => {
    if (data && document.activeElement !== bodyRef.current) session.receive(data);
  }, [data, dataUpdatedAt]);
}
