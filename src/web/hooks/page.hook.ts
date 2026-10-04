import { type Page, pageOf, PAGES } from "@/shared/pages";
import { useStore } from "@/web/hooks/store.hook";
import { session } from "@/web/lib/session";
import { Store } from "@/web/lib/store";

// Which page is open follows the address, so back and forward move between them.
const page = new Store<Page>(pageOf(location.pathname));
window.addEventListener("popstate", () => page.set(pageOf(location.pathname)));

export const usePage = () => useStore(page);

/** Leaving the notes never waits for the network, as with leaving a note. */
export function go(next: Page) {
  session.flush();
  history.pushState(null, "", PAGES[next]);
  page.set(next);
}
