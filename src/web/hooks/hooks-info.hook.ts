import { useMutation, useQuery } from "@tanstack/react-query";

import { type HookName, scopeLocation } from "@/shared/hooks";
import { useUnsyncedIds } from "@/web/hooks/pending.hook";
import { api, type HooksInfo, isApiError, type Note } from "@/web/lib/api";
import { handle } from "@/web/lib/failures";
import { pickState, withPick } from "@/web/lib/hooks";
import { keys, queryClient } from "@/web/lib/queries";

// The agent hooks' choices: loaded once and after each change, not polled, since only Settings,
// the list's menu and `pad hooks` change them. A server without them answers `notFound`, read
// as null: the app then offers no hook choices at all.
export function useHooksInfo() {
  const { data, isPending } = useQuery({
    queryKey: keys.hooks,
    queryFn: () =>
      api.hooks().catch((e: unknown) => {
        if (isApiError(e, "notFound")) return null;
        throw e;
      }),
    staleTime: Infinity,
  });
  return { info: data ?? null, supported: isPending || data !== null };
}

/** After a change: the choices, and what each place shows, asked again. */
const refetch = () => queryClient.invalidateQueries({ queryKey: keys.hooks });

/** Hand-picking from the list applies everywhere, shown at once; Settings picks per place. */
export function useHookPicks() {
  const { info, supported } = useHooksInfo();
  const unsynced = useUnsyncedIds();
  const stateOf = (id: string, hook: HookName) => pickState(id, hook, info, unsynced);
  const { mutate } = useMutation({
    mutationFn: ({ id, hook, pick }: { id: string; hook: HookName; pick: boolean }) =>
      pick ? api.pickHookNote(hook, id) : api.unpickHookNote(hook, id),
    onMutate: async ({ id, hook, pick }) => {
      await queryClient.cancelQueries({ queryKey: keys.hooks });
      const before = queryClient.getQueryData<HooksInfo | null>(keys.hooks);
      if (before) queryClient.setQueryData(keys.hooks, withPick(before, hook, id, pick));
      return { before };
    },
    onError: (e, _, context) => {
      queryClient.setQueryData(keys.hooks, context?.before);
      handle(e);
    },
    onSettled: refetch,
  });
  return {
    /** Undefined when the server keeps no hook choices. */
    pickOf: supported ? stateOf : undefined,
    toggle: (note: Note, hook: HookName) =>
      mutate({ id: note.id, hook, pick: !stateOf(note.id, hook).picked }),
  };
}

/** What `hook` shows where `scope` applies, as the server resolves it. */
export const useHookSection = (hook: HookName, scope: string) =>
  useQuery({
    queryKey: keys.hookNotes(hook, scope),
    queryFn: () => api.hookNotes(hook, scopeLocation(scope)),
    select: (r) => r.sections.find((s) => s.scope === scope) ?? null,
    staleTime: Infinity,
  }).data ?? null;

/**
 * Settings' changes to a hook's choices. Each resolves once the app knows the result, and
 * rejects with the API's refusal for the form to word.
 */
export function useHookChoices(hook: HookName) {
  const { mutateAsync } = useMutation({
    mutationFn: (change: () => Promise<unknown>) => change(),
    onSuccess: refetch,
  });
  return {
    save: (selection: { scope: string; query: string | null; limit?: number }) =>
      mutateAsync(() => api.saveHookSelection(hook, selection)),
    reset: (scope: string) => mutateAsync(() => api.deleteHookSelection(hook, scope)),
    unpick: (id: string, scope: string) => mutateAsync(() => api.unpickHookNote(hook, id, scope)),
  };
}
