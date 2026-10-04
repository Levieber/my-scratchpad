import { type Layout, shownLayout } from "@/shared/layouts";
import { currentRoute } from "@/web/hooks/route.hook";
import { useSearch } from "@/web/hooks/search.hook";
import { useStore } from "@/web/hooks/store.hook";
import { usePickedOptions } from "@/web/hooks/view-option.hook";
import { sameQuery, useActiveView, useViewMutations } from "@/web/hooks/views.hook";
import type { NewView } from "@/web/lib/api";
import { preferredLayout } from "@/web/lib/layout-prefs";
import { Store } from "@/web/lib/store";

/**
 * A layout picked on this page, or named by the address it was opened at, for the search it was
 * picked with. It wins over the view's and the device's while that search is in force, so a
 * shared link shows what its sender saw, and a pick shows at once even offline.
 */
const picked = new Store<{ q: string; layout: string } | null>(
  currentRoute().layout ? { q: currentRoute().q, layout: currentRoute().layout! } : null,
);

/**
 * How the search in force is shown: what was picked for it, else its view's layout, else this
 * device's preference. `unknown` is a layout from a newer app, shown as the list.
 */
export function useLayout() {
  const { q } = useSearch();
  const view = useActiveView();
  const preference = useStore(preferredLayout);
  const pick = useStore(picked);
  const chosen = pick && sameQuery(pick.q, q) ? pick.layout : (view?.layout ?? null);
  return shownLayout(chosen, preference);
}

/**
 * Picking a layout: it shows at once, and is kept by the search's view if it has one, or else
 * as this device's preference.
 */
export function useChooseLayout() {
  const { q } = useSearch();
  const view = useActiveView();
  const { update } = useViewMutations();
  return (layout: Layout) => {
    picked.set({ q, layout });
    if (view) {
      if (view.layout !== layout) update(view, { layout });
    } else preferredLayout.set(layout);
  };
}

/**
 * What a view saved now keeps of how it is shown: a layout picked for this search, and the
 * options set for it. What nobody chose is left out, to stay each device's own.
 */
export function usePickedFor(): Pick<NewView, "layout" | "options"> {
  const { q } = useSearch();
  const pick = useStore(picked);
  const layout = useLayout().layout;
  const options = usePickedOptions();
  return { ...(pick && sameQuery(pick.q, q) && { layout }), ...options };
}
