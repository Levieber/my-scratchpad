// The PWA's addresses, read and built in one place: the page (shared/pages.ts) and, on the notes,
// what they show: `?q=…&layout=…&note=…`. A link or a reload reopens the same view from them.
// Measured against TanStack Router (+28 KB gz, about a fifth of the app): this is all it needed.
import { type Page, pageOf, PAGES } from "@/shared/pages";

export type Route = {
  page: Page;
  /** The search, operators included (shared/query.ts). */
  q: string;
  /** As written: possibly a layout from a newer app, which shows as the list. */
  layout: string | null;
  /** The open note's id. */
  note: string | null;
};

const none = { q: "", layout: null, note: null };

/** What an address says. Only the notes have parameters; another page ignores them. */
export function routeOf({ pathname, search }: { pathname: string; search: string }): Route {
  const page = pageOf(pathname);
  if (page !== "notes") return { page, ...none };
  const p = new URLSearchParams(search);
  return {
    page,
    q: p.get("q") ?? "",
    layout: p.get("layout") || null,
    note: p.get("note") || null,
  };
}

/** The address for `route`, leaving out what is empty. */
export function hrefOf(route: Route): string {
  if (route.page !== "notes") return PAGES[route.page];
  const p = new URLSearchParams();
  if (route.q.trim()) p.set("q", route.q);
  if (route.layout) p.set("layout", route.layout);
  if (route.note) p.set("note", route.note);
  const search = p.toString();
  return search ? `${PAGES.notes}?${search}` : PAGES.notes;
}
