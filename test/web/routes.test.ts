import { describe, expect, test } from "bun:test";

import { PAGES } from "@/shared/pages";
import { hrefOf, type Route, routeOf } from "@/web/lib/routes";

const at = (href: string) => routeOf(new URL(href, "https://pad.test"));

describe("routes", () => {
  test("reads the search, the layout and the open note from the notes' address", () => {
    expect(at("/?q=%23work%20kind%3Areference&layout=table&note=abc12345")).toEqual({
      page: "notes",
      q: "#work kind:reference",
      layout: "table",
      note: "abc12345",
    });
    expect(at("/")).toEqual({ page: "notes", q: "", layout: null, note: null });
  });

  test("another page has no parameters", () => {
    expect(at("/settings?q=x&note=y")).toEqual({
      page: "settings",
      q: "",
      layout: null,
      note: null,
    });
  });

  test("leaves out what is empty", () => {
    expect(hrefOf({ page: "notes", q: "  ", layout: null, note: null })).toBe("/");
    expect(hrefOf({ page: "notes", q: "", layout: "grid", note: null })).toBe("/?layout=grid");
    expect(hrefOf({ page: "settings", q: "x", layout: "grid", note: "n" })).toBe(PAGES.settings);
  });

  test("an address built from a route reads back as it", () => {
    const routes: Route[] = [
      { page: "notes", q: "#todo author:agent & more?", layout: "calendar", note: "a_b-c123" },
      { page: "notes", q: "", layout: null, note: "only-a-note" },
      { page: "settings", q: "", layout: null, note: null },
    ];
    for (const route of routes) expect(at(hrefOf(route))).toEqual(route);
  });
});
