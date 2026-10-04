import { useEffect } from "react";

import type { HookName } from "@/shared/hooks";
import { useUnsyncedIds } from "@/web/hooks/pending.hook";
import { useStore } from "@/web/hooks/store.hook";
import { api, type HooksInfo, isApiError, type Note } from "@/web/lib/api";
import { handle } from "@/web/lib/failures";
import { pickState } from "@/web/lib/hooks";
import { Store } from "@/web/lib/store";

// The agent hooks' choices: loaded once and after each change, not polled, since only Settings,
// the list's menu and `pad hooks` change them. A server without them answers `notFound`; the app
// then offers no hook choices at all.
const hooks = new Store<{ info: HooksInfo | null; supported: boolean }>({
  info: null,
  supported: true,
});
let loaded = false;

export async function refreshHooks() {
  try {
    hooks.set({ info: await api.hooks(), supported: true });
  } catch (e) {
    if (isApiError(e, "notFound")) hooks.set({ info: hooks.get().info, supported: false });
    else handle(e);
  }
}

export function useHooksInfo() {
  useEffect(() => {
    if (loaded) return;
    loaded = true;
    void refreshHooks();
  }, []);
  return useStore(hooks);
}

/** Hand-picking from the list applies everywhere; Settings picks per repository or folder. */
export function useHookPicks() {
  const { info, supported } = useHooksInfo();
  const unsynced = useUnsyncedIds();
  const stateOf = (id: string, hook: HookName) => pickState(id, hook, info, unsynced);
  return {
    /** Undefined when the server keeps no hook choices. */
    pickOf: supported ? stateOf : undefined,
    toggle: async (note: Note, hook: HookName) => {
      try {
        await (stateOf(note.id, hook).picked
          ? api.unpickHookNote(hook, note.id)
          : api.pickHookNote(hook, note.id));
      } catch (e) {
        handle(e);
      }
      await refreshHooks();
    },
  };
}
