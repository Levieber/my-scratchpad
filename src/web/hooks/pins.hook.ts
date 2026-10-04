import { useData, usePins } from "@/web/hooks/data.hook";
import { useUnsyncedIds } from "@/web/hooks/pending.hook";
import { api, type Note } from "@/web/lib/api";
import { handle } from "@/web/lib/failures";
import { pinState } from "@/web/lib/pins";

/** Whether a note can be pinned or unpinned right now (lib/pins.ts). */
export function usePinOf() {
  const pinned = usePins();
  const unsynced = useUnsyncedIds();
  const ids = new Set(pinned.map((n) => n.id));
  return (id: string | undefined) => pinState(id, ids, unsynced);
}

/** Shown at once, then corrected by what the server says; a refusal puts the list back. */
export function usePinToggle() {
  const { setPins, refresh } = useData();
  const pinned = usePins();
  return async (note: Note) => {
    const unpin = pinned.some((n) => n.id === note.id);
    setPins((p) => (unpin ? p.filter((n) => n.id !== note.id) : [...p, note]));
    try {
      await (unpin ? api.unpin(note.id) : api.pin(note.id));
    } catch (e) {
      handle(e);
    }
    await refresh();
  };
}
