import { describe, expect, test } from "bun:test";

import { pageOf, PAGES } from "@/shared/pages";

describe("pageOf", () => {
  test("names the page an address is for, with or without a trailing slash", () => {
    expect(pageOf("/")).toBe("notes");
    expect(pageOf("")).toBe("notes");
    expect(pageOf("/settings")).toBe("settings");
    expect(pageOf("/settings/")).toBe("settings");
  });

  test("an address that is no page opens the notes", () => {
    expect(pageOf("/elsewhere")).toBe("notes");
  });

  test("every page's address leads back to it", () => {
    for (const [page, path] of Object.entries(PAGES)) expect(pageOf(path)).toBe(page as never);
  });
});
