import { replacing } from "@/shared/layouts";
import { useSearch } from "@/web/hooks/search.hook";
import { useStore } from "@/web/hooks/store.hook";
import { sameQuery, useActiveView, useViewMutations } from "@/web/hooks/views.hook";
import { Store } from "@/web/lib/store";

// Options set on this page for a search: they show at once, even offline, over the view's.
const picked = new Store<{ q: string; values: Record<string, unknown> } | null>(null);

/**
 * One of a layout's options (shared/domain.ts LAYOUT_OPTIONS) for the search in force, and
 * setting it: kept by the search's view, if it has one. `read` turns what is stored (by any
 * version of the app) into what this one shows. Only this option is sent, so the view's others,
 * known here or not, stay as they are; `whole` replaces it rather than merging into it, for an
 * option whose shapes differ.
 */
export function useViewOption<T>(
  name: string,
  read: (stored: unknown) => T,
  { whole = false } = {},
) {
  const { q } = useSearch();
  const view = useActiveView();
  const { update } = useViewMutations();
  const pick = useStore(picked);
  const mine = pick && sameQuery(pick.q, q) ? pick.values : {};
  const value = read(name in mine ? mine[name] : view?.options[name]);
  const set = (next: T | null) => {
    picked.set({ q, values: { ...mine, [name]: next } });
    if (view) {
      const sent = whole ? replacing(view.options[name], next) : next;
      update(view, { options: { [name]: sent } });
    }
  };
  return [value, set] as const;
}
