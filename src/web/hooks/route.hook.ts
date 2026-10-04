import { useSyncExternalStore } from "react";

import type { Page } from "@/shared/pages";
import { hrefOf, type Route, routeOf } from "@/web/lib/routes";
import { session } from "@/web/lib/session";
import { Store } from "@/web/lib/store";

// Which page is open follows the address, so back and forward move between pages. What the
// notes show (search, layout, open note) is written into the address in place: it is state to
// share or reload, not steps to go back through.
const route = new Store<Route>(routeOf(location));
// Where the notes were, to come back to from another page.
let notes = route.get();
window.addEventListener("popstate", () => {
  route.set(routeOf(location));
  if (route.get().page === "notes") notes = route.get();
});

/** The address as the app was opened at, or is now. */
export const currentRoute = route.get;

export const usePage = () => useSyncExternalStore(route.subscribe, () => route.get().page);

/** Leaving the notes never waits for the network, as with leaving a note. */
export function go(next: Page) {
  session.flush();
  const to: Route = next === "notes" ? notes : { page: next, q: "", layout: null, note: null };
  history.pushState(null, "", hrefOf(to));
  route.set(to);
}

/** Says in the address what the notes show now. Nothing changes while another page is open. */
export function showInAddress(patch: Partial<Omit<Route, "page">>) {
  const next = { ...notes, ...patch };
  if (hrefOf(next) === hrefOf(notes)) return;
  notes = next;
  if (route.get().page !== "notes") return;
  history.replaceState(history.state, "", hrefOf(next));
  route.set(next);
}
