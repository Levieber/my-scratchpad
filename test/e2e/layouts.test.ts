// Each layout of the notes (shared/layouts.ts) in a real browser: at a phone's widths and a
// desktop's, from the keyboard, offline, and from a link opened somewhere else.
import { expect, test } from "bun:test";

import { describeE2E, eventually, useApp, violations } from "@test/e2e/support";
import type { Page } from "playwright-core";

import type { View } from "@/shared/domain";
import { LAYOUTS } from "@/shared/layouts";

const WIDTHS = [320, 390, 1280];

/** The layout the notes are shown in (notes.tsx), once it has settled on `expected`. */
const shownAs = (page: Page, expected: string) =>
  page.locator(`nav[aria-label=Notes][data-layout=${expected}]`).waitFor();

const pick = (page: Page, label: string) =>
  page.getByRole("group", { name: "Layout" }).getByRole("button", { name: label }).click();

describeE2E("layouts", () => {
  const app = useApp();
  const views = async () =>
    (await (await fetch(new URL("/api/views", app.server.url))).json()) as View[];

  for (const width of WIDTHS)
    test(`at ${width} px every layout fits: no sideways scroll, 24 px targets`, async () => {
      await app.api.create({
        title: `A long title that has to wrap somewhere on a phone ${width}`,
        body: "- [ ] one\n- [x] two\n\n```ts\nconst wide = 'a line of code far wider than any phone';\n```",
        tags: ["layouts", "a-rather-long-tag-name"],
      });
      const page = await app.open(width);
      const found: Record<string, string[]> = {};
      for (const { key, label } of LAYOUTS) {
        await pick(page, label);
        // A phone has no room for the table: it shows the list.
        await shownAs(page, key === "table" && width < 721 ? "list" : key);
        found[key] = await violations(page);
      }
      expect(found).toEqual({ list: [], grid: [], table: [] });
    }, 20_000);

  test("keyboard only: from the search to the picker, arrows, and Space", async () => {
    await app.api.create({ body: "keyboard layouts" });
    const page = await app.open();
    await page.getByRole("searchbox").focus();
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe(
      "List",
    );
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Space");
    await shownAs(page, "grid");
    // The device remembers it: a new page opens in it.
    await page.reload();
    await shownAs(page, "grid");
  });

  test("switches layout offline", async () => {
    await app.api.create({ body: "offline layouts" });
    const page = await app.open();
    await page.getByRole("button", { name: /^offline layouts/ }).waitFor();
    await page.context().setOffline(true);
    for (const { key, label } of [...LAYOUTS].reverse()) {
      await pick(page, label);
      await shownAs(page, key);
    }
    await page.getByRole("button", { name: /^offline layouts/ }).waitFor();
    await page.context().setOffline(false);
  }, 20_000);

  test("an address reopens the same search, layout and note somewhere else", async () => {
    await app.api.create({ title: "Linked", body: "found by its link", tags: ["linked"] });
    const page = await app.open();
    await page.getByRole("searchbox").fill("#linked");
    await pick(page, "Table");
    await shownAs(page, "table");
    await page.getByRole("table").getByRole("button", { name: "Linked", exact: true }).click();
    await page.getByPlaceholder("Title").waitFor();
    await eventually(() => expect(new URL(page.url()).searchParams.get("note")).toBeTruthy());
    const url = page.url();
    expect(Object.fromEntries(new URL(url).searchParams)).toMatchObject({
      q: "#linked",
      layout: "table",
    });

    // A fresh context: nothing in its storage, so all it has is the address.
    const other = await (await app.context()).newPage();
    await other.goto(url);
    await eventually(async () =>
      expect(await other.getByPlaceholder("Title").inputValue()).toBe("Linked"),
    );
    expect(await other.getByRole("searchbox").inputValue()).toBe("#linked");
  }, 20_000);

  test("a view keeps its layout and its table's order", async () => {
    await app.api.create({ title: "b sorted", body: "x", tags: ["sorted"] });
    await app.api.create({ title: "a sorted", body: "y", tags: ["sorted"] });
    const page = await app.open();
    await page.getByRole("searchbox").fill("#sorted");
    await pick(page, "Table");
    await page.getByRole("button", { name: "Save this search" }).click();
    await page.getByPlaceholder("Name this view").fill("Sorted");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await eventually(async () =>
      expect((await views()).find((v) => v.name === "Sorted")).toMatchObject({ layout: "table" }),
    );

    await page.getByRole("columnheader", { name: "Title" }).getByRole("button").click();
    await eventually(async () =>
      expect((await views()).find((v) => v.name === "Sorted")?.options).toEqual({
        sort: { by: "title", desc: false },
      }),
    );
    const titles = page.getByRole("table").getByRole("row").locator("td:first-child");
    await eventually(async () =>
      expect(await titles.allInnerTexts()).toEqual(["a sorted", "b sorted"]),
    );

    // Somewhere else, with another preference, the view still says table.
    const other = await app.open(1280);
    await pick(other, "Grid");
    await other
      .getByRole("group", { name: "Saved views" })
      .getByRole("button", { name: "Sorted", exact: true })
      .click();
    await shownAs(other, "table");
  }, 20_000);

  test("a layout this app doesn't know shows as the list, and says so", async () => {
    const page = await app.open(1280, "/?layout=calendar");
    await shownAs(page, "list");
    await page.getByRole("note").getByText("calendar").waitFor();
  });
});
