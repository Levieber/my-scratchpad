/**
 * The PWA's pages and their addresses, in one place: the server serves the app at each, and the
 * app reads which one it is on. A new page, or a prefix for every address later, is one change.
 */
export const PAGES = { notes: "/", settings: "/settings" } as const;

export type Page = keyof typeof PAGES;

export const pageOf = (pathname: string): Page =>
  (Object.keys(PAGES) as Page[]).find((p) => PAGES[p] === (pathname.replace(/\/+$/, "") || "/")) ??
  "notes";
