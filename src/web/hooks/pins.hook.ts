import { useMutation } from "@tanstack/react-query";

import { usePins } from "@/web/hooks/notes.hook";
import { useUnsyncedIds } from "@/web/hooks/pending.hook";
import { api, type Note } from "@/web/lib/api";
import { handle } from "@/web/lib/failures";
import { pinState, withPin } from "@/web/lib/pins";
import { keys, queryClient } from "@/web/lib/queries";

/** Whether a note can be pinned or unpinned right now (lib/pins.ts). */
export function usePinOf() {
  const pinned = usePins();
  const unsynced = useUnsyncedIds();
  const ids = new Set(pinned.map((n) => n.id));
  return (id: string | undefined) => pinState(id, ids, unsynced);
}

/** Shown at once, then corrected by what the server says; a refusal puts the list back. */
export function usePinToggle() {
  const pinned = usePins();
  const { mutate } = useMutation({
    mutationFn: ({ note, unpin }: { note: Note; unpin: boolean }) =>
      unpin ? api.unpin(note.id) : api.pin(note.id),
    onMutate: async ({ note, unpin }) => {
      await queryClient.cancelQueries({ queryKey: keys.pins });
      const before = queryClient.getQueryData<Note[]>(keys.pins);
      queryClient.setQueryData<Note[]>(keys.pins, (p = []) => withPin(p, note, !unpin));
      return { before };
    },
    onError: (e, _, context) => {
      queryClient.setQueryData(keys.pins, context?.before);
      handle(e);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.pins }),
  });
  // Pinned or not as the cache has it now, not as of the last render: a second press before the
  // list re-renders toggles back rather than pinning again.
  return (note: Note) => {
    const now = queryClient.getQueryData<Note[]>(keys.pins) ?? pinned;
    mutate({ note, unpin: now.some((n) => n.id === note.id) });
  };
}
