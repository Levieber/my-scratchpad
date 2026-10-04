import { useSyncExternalStore } from "react";

import { useListed } from "@/web/hooks/data.hook";
import { api, type Note, Unauthorized } from "@/web/lib/api";
import { handle } from "@/web/lib/failures";
import { session } from "@/web/lib/session";
import { outbox } from "@/web/lib/storage";
import { localNote } from "@/web/lib/sync";

/** The open note and its form, as the editor session has them (lib/editor-session.ts). */
export const useEditor = () => useSyncExternalStore(session.subscribe, session.getSnapshot);

/** Opens a note from the server; offline, or made here and not synced yet, from what this device has. */
export function useOpenNote() {
  const listed = useListed();
  return (id: string) =>
    session
      .open(async () => {
        try {
          return await api.get(id);
        } catch (e) {
          const p = outbox.get(id);
          const known =
            listed.find((n) => n.id === id) ??
            (p?.op === "save" ? localNote(id, p.fields) : undefined);
          if (known && !(e instanceof Unauthorized)) return known;
          throw e;
        }
      })
      .catch(handle);
}

/** Deletes a note from the list, or the open one (which may be a new note never saved). */
export function removeNote(note?: Note) {
  const target = note ?? session.getSnapshot().current;
  if (target && !confirm(`Delete "${target.title}"?`)) return;
  session.remove(target ?? undefined);
}
