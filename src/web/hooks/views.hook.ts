import { useMutation } from "@tanstack/react-query";

import { useSearch } from "@/web/hooks/search.hook";
import { api, isApiError, type View } from "@/web/lib/api";
import { handle } from "@/web/lib/failures";
import { keys, queryClient } from "@/web/lib/queries";

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

/** Saving the search in force as a view, and deleting one; both show at once. */
export function useViewMutations() {
  const { q } = useSearch();
  const create = useMutation({
    mutationFn: (view: { name: string; query: string }) => api.createView(view.name, view.query),
    onMutate: (view) =>
      optimistic((v) => [
        ...v,
        { ...view, id: `saving:${view.name}`, created_at: new Date().toISOString() },
      ]),
    onError: rollback,
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
    save: async (name: string) => {
      try {
        await create.mutateAsync({ name, query: q.trim() });
        return "saved" as const;
      } catch (e) {
        if (isApiError(e, "viewExists")) return "taken" as const;
        handle(e);
        return "failed" as const;
      }
    },
    remove: (view: View) => remove.mutate(view),
  };
}
