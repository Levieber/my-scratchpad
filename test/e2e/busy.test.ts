// A scratchpad in use for months: more notes than a page loads, a long tail of tags, more saved
// views than fit on a line. The list keeps the screen and every note, tag and view stays in reach.
import { expect, test } from "bun:test";

import { describeE2E, eventually, useApp, violations } from "@test/e2e/support";
import type { Page } from "playwright-core";

/** The notes the list shows (each a row). */
const rows = (page: Page) =>
  page.getByRole("navigation", { name: "Notes" }).getByRole("listitem").count();

describeE2E("a busy scratchpad", () => {
  const app = useApp();
  const call = (method: string, path: string, body: unknown) =>
    fetch(new URL(path, app.server.url), {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  // More than two pages of the list (50 each), under a tag of their own.
  const MANY = 120;
  let seeded: Promise<unknown> | null = null;
  const seedMany = () =>
    (seeded ??= (async () => {
      for (let i = 0; i < MANY; i++)
        await app.api.create({ title: `Scrolled ${i}`, tags: ["scroll"] });
    })());

  test("scrolling to the end of the list loads the next notes, without a click", async () => {
    await seedMany();
    const page = await app.open(1280, "/?q=%23scroll");
    await eventually(async () => expect(await rows(page)).toBe(50));
    const list = page.getByRole("navigation", { name: "Notes" });
    await eventually(async () => {
      await list.evaluate((nav) => nav.scrollTo(0, nav.scrollHeight));
      expect(await rows(page)).toBe(MANY);
    }, 10_000);
    // Everything is loaded: nothing more to offer.
    expect(await page.getByRole("button", { name: "Load more" }).count()).toBe(0);
  }, 30_000);

  test("a long tail of tags is found by typing, not unfolded as a wall of chips", async () => {
    for (let i = 0; i < 30; i++)
      // Fewer notes for each later tag, so the API ranks them tag-0 first.
      await app.api.create({
        title: `Tagged ${i}`,
        tags: [`tail-${i}`, ...(i < 10 ? ["tail-0"] : [])],
      });
    const page = await app.open(1280);
    const inline = page.getByRole("group", { name: "Tags", exact: true }).getByRole("button");
    expect(await inline.count()).toBeLessThanOrEqual(8);

    await page.getByRole("button", { name: /^All \d+ tags$/ }).click();
    await page.getByRole("searchbox", { name: "Find a tag" }).fill("#TAIL-2");
    const found = page.getByRole("group", { name: "All tags" }).getByRole("button");
    // tail-2, then tail-20 to tail-29.
    await eventually(async () => expect(await found.count()).toBe(11));
    // One under another, each in sight of the picker's list (scrolled to, not cut off beside it).
    const boxes = await found.evaluateAll((els) =>
      els.map((el) => {
        const { left, right } = el.getBoundingClientRect();
        const list = el.parentElement!.getBoundingClientRect();
        return { left: Math.round(left), inside: left >= list.left && right <= list.right };
      }),
    );
    expect(new Set(boxes.map((b) => b.left)).size).toBe(1);
    expect(boxes.every((b) => b.inside)).toBe(true);
    await found.filter({ hasText: "#tail-25" }).click();

    await eventually(async () =>
      expect(await page.getByRole("searchbox", { name: "Search" }).inputValue()).toBe("#tail-25"),
    );
    // A selected tag stays in sight once the picker is closed.
    await page.keyboard.press("Escape");
    await page.getByRole("group", { name: "All tags" }).waitFor({ state: "hidden" });
    expect(await inline.filter({ hasText: "#tail-25" }).getAttribute("aria-pressed")).toBe("true");
  }, 30_000);

  test("past the first few, saved views are one chip away, and the one in force stays in sight", async () => {
    for (let i = 1; i <= 9; i++)
      await call("POST", "/api/views", { name: `Busy view ${i}`, query: `#busy-${i}` });
    const page = await app.open(1280);
    const views = page.getByRole("group", { name: "Saved views" });
    await views.getByRole("button", { name: "+3 views" }).click();
    const more = page.getByRole("group", { name: "More saved views" });
    await more.getByRole("button", { name: "Busy view 9", exact: true }).click();

    await eventually(async () =>
      expect(await page.getByRole("searchbox", { name: "Search" }).inputValue()).toBe("#busy-9"),
    );
    await page.keyboard.press("Escape");
    expect(
      await views
        .getByRole("button", { name: "Busy view 9", exact: true })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  }, 30_000);

  for (const width of [320, 390])
    test(`at ${width} px the chips keep to a few lines and the tag picker fits`, async () => {
      await seedMany();
      const page = await app.open(width);
      const chips = await page
        .getByRole("group", { name: "Tags" })
        .evaluate((g) => g.getBoundingClientRect().height);
      // Two lines of 24 px chips and their gap, at most.
      expect(chips).toBeLessThanOrEqual(2 * 24 + 6);
      await page.getByRole("button", { name: /^All \d+ tags$/ }).click();
      await page.getByRole("searchbox", { name: "Find a tag" }).waitFor();
      expect(await violations(page)).toEqual([]);
    }, 30_000);
});
