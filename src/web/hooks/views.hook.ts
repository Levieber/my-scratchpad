import { useData } from "@/web/hooks/data.hook";
import { api, isApiError, type View } from "@/web/lib/api";
import { handle } from "@/web/lib/failures";

/** Saving the search in force as a view, and deleting one. */
export function useViewMutations() {
  const { q, refresh } = useData();
  return {
    /** Says whether the name was taken, the one failure the person can fix. */
    save: async (name: string) => {
      try {
        await api.createView(name, q.trim());
        void refresh();
        return "saved" as const;
      } catch (e) {
        if (isApiError(e, "viewExists")) return "taken" as const;
        handle(e);
        return "failed" as const;
      }
    },
    remove: async (view: View) => {
      try {
        await api.deleteView(view.id);
        await refresh();
      } catch (e) {
        handle(e);
      }
    },
  };
}
