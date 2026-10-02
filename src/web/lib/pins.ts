// Whether a note can be pinned or unpinned right now, and the hint that says why not. The editor
// and the list share it, so both refuse for the same reasons in the same words.
import { MAX_PINS } from "@/shared/pins";

export type PinState = { pinned: boolean; disabled: boolean; hint: string };

export function pinState(
  id: string | undefined,
  pinnedIds: ReadonlySet<string>,
  /** Notes made here that the server hasn't seen: it can't pin what it doesn't have. */
  unsyncedIds: ReadonlySet<string>,
): PinState {
  const pinned = id !== undefined && pinnedIds.has(id);
  if (pinned) return { pinned, disabled: false, hint: "Unpin from the top of the list" };
  if (id === undefined || unsyncedIds.has(id))
    return { pinned, disabled: true, hint: "Pinning starts once the note has synced" };
  if (pinnedIds.size >= MAX_PINS)
    return {
      pinned,
      disabled: true,
      hint: `${MAX_PINS} notes are pinned already: unpin one first`,
    };
  return { pinned, disabled: false, hint: "Keep at the top of the list" };
}
