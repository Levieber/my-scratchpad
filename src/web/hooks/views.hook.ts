import { useMutation } from "@tanstack/react-query";

import { mergePatch } from "@/shared/layouts";
import { useViews } from "@/web/hooks/notes.hook";
import { useSearch } from "@/web/hooks/search.hook";
import { api, isApiError, type NewView, type View, type ViewPatch } from "@/web/lib/api";
import { handle } from "@/web/lib/failures";
import { keys, queryClient } from "@/web/lib/queries";

const SAVING = "saving:";

/** A view shown before the server has it: it may yet be refused (a name already taken). */
export const isSaving = (view: View) => view.id.startsWith(SAVING);

export const sameQuery = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The view whose search is in force, if any. One still being saved isn't yet: it may be refused,
 * and the form naming it stays until it is.
 */
export function useActiveView() {
  const views = useViews();
  const { q } = useSearch();
  return views.find((v) => !isSaving(v) && sameQuery(v.query, q));
}

/** `view` as `patch` leaves it: the server merges options the same way (shared/layouts.ts). */
const patched = (view: View, { options, ...fields }: ViewPatch): View => ({
  ...view,
  ...fields,
  options: options ? (mergePatch(view.options, options) as View["options"]) : view.options,
});

/** Puts `change` in the views at once; what it returns undoes it. */
async function optimistic(change: (views: View[]) => View[]) {
  await queryClient.cancelQueries({ queryKey: keys.views });
  const before = queryClient.getQueryData<View[]>(keys.views);
  queryClient.setQueryData<View[]>(keys.views, (v = []) => change(v));
  return { before };
}

const rollback = (_e: unknown, _v: unknown, context: { before?: View[] } | undefined) =>
  queryClient.setQueryData(keys.views, context?.before);
const refetch = () => queryClient.invalidateQueries({ queryKey: keys.views });

/** Saving the search in force as a view, changing one and deleting one; all show at once. */
export function useViewMutations() {
  const { q } = useSearch();
  const create = useMutation({
    mutationFn: (view: NewView) => api.createView(view),
    onMutate: (view) =>
      optimistic((v) => [
        ...v,
        {
          layout: null,
          options: {},
          ...view,
          id: `${SAVING}${view.name}`,
          created_at: new Date().toISOString(),
        },
      ]),
    onError: rollback,
    onSettled: refetch,
  });
  const update = useMutation({
    mutationFn: ({ view, patch }: { view: View; patch: ViewPatch }) =>
      api.updateView(view.id, patch),
    onMutate: ({ view, patch }) =>
      optimistic((v) => v.map((x) => (x.id === view.id ? patched(x, patch) : x))),
    onError: (e, vars, context) => {
      rollback(e, vars, context);
      handle(e);
    },
    onSettled: refetch,
  });
  const remove = useMutation({
    mutationFn: (view: View) => api.deleteView(view.id),
    onMutate: (view) => optimistic((v) => v.filter((x) => x.id !== view.id)),
    onError: (e, view, context) => {
      rollback(e, view, context);
      handle(e);
    },
    onSettled: refetch,
  });
  return {
    /** Says whether the name was taken, the one failure the person can fix. */
    save: async (name: string, how: Pick<NewView, "layout" | "options"> = {}) => {
      try {
        await create.mutateAsync({ name, query: q.trim(), ...how });
        return "saved" as const;
      } catch (e) {
        if (isApiError(e, "viewExists")) return "taken" as const;
        handle(e);
        return "failed" as const;
      }
    },
    /** Send only what changed, so what another client set survives. */
    update: (view: View, patch: ViewPatch) => update.mutate({ view, patch }),
    remove: (view: View) => remove.mutate(view),
  };
}
