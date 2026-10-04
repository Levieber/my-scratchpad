import type { KnownViewOptions } from "@/shared/domain";
import { isObject, TABLE_COLUMNS } from "@/shared/layouts";
import { useSearch } from "@/web/hooks/search.hook";
import { useStore } from "@/web/hooks/store.hook";
import { sameQuery, useActiveView, useViewMutations } from "@/web/hooks/views.hook";
import { Store } from "@/web/lib/store";

export type TableSort = NonNullable<KnownViewOptions["sort"]>;

/** A view's `options.sort`, if it is one this app can read (a newer app may have written it). */
const readSort = (value: unknown): TableSort | null =>
  isObject(value) && TABLE_COLUMNS.some((c) => c === value.by)
    ? { by: value.by as TableSort["by"], desc: value.desc === true }
    : null;

// The order picked on this page for a search: it shows at once, even offline, over the view's.
const picked = new Store<{ q: string; sort: TableSort | null } | null>(null);

/** How the table is sorted, and sorting it: kept by the search's view, if it has one. */
export function useTableSort() {
  const { q } = useSearch();
  const view = useActiveView();
  const { update } = useViewMutations();
  const pick = useStore(picked);
  const sort = pick && sameQuery(pick.q, q) ? pick.sort : readSort(view?.options.sort);
  const setSort = (next: TableSort | null) => {
    picked.set({ q, sort: next });
    // Only `sort` is sent: the view's other options, known here or not, stay as they are.
    if (view) update(view, { options: { sort: next } });
  };
  return { sort, setSort };
}
