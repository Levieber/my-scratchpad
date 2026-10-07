// One scrollbar for each thing that scrolls, at the edge of what it scrolls: the list's column
// and Settings' page column scroll on their own, and the page itself never does. Before, the list
// scrolled the width of the window (its scrollbar at the window's edge, far from the notes), and
// Settings scrolled twice, the page and its column, each with its own bar.
import { expect, test } from "bun:test";

import { describeE2E, eventually, scrollers, useApp } from "@test/e2e/support";

describeE2E("scrolling", () => {
  const app = useApp();
  let seeded: Promise<unknown> | null = null;
  const seed = () =>
    (seeded ??= (async () => {
      for (let i = 0; i < 30; i++)
        await app.api.create({ title: `Scrolling ${i}`, body: "A line.\n\nAnother.", tags: ["s"] });
    })());

  test("the list scrolls in its column, lined up with the search above it", async () => {
    await seed();
    const page = await app.open(1280);
    const list = page.getByRole("navigation", { name: "Notes" });
    await eventually(async () =>
      expect(await scrollers(page)).toEqual([expect.objectContaining({ name: "nav[Notes]" })]),
    );
    const [nav] = await scrollers(page);
    // The column, centred, not the window: its scrollbar beside the notes.
    expect(nav!.right - nav!.left).toBeLessThanOrEqual(820);
    expect(nav!.left).toBeGreaterThan(0);
    expect(nav!.scrollbar).toBeGreaterThan(0);
    // The search's column keeps the same gutter, so a row ends where the New button does.
    const edge = async (el: ReturnType<typeof page.locator>) =>
      Math.round((await el.boundingBox())!.x + (await el.boundingBox())!.width);
    expect(await edge(list.getByRole("listitem").first())).toBe(
      await edge(page.getByRole("button", { name: "New", exact: true })),
    );
  }, 30_000);

  test("beside an open note, the list's column is the one scroll area of the list", async () => {
    await seed();
    const note = await app.api.create({ title: "Open beside" });
    const page = await app.open(1280, `/?note=${note.id}`);
    await page.getByPlaceholder("Title").waitFor();
    await eventually(async () =>
      expect((await scrollers(page)).map((s) => s.name)).toEqual(["nav[Notes]"]),
    );
  }, 30_000);

  for (const width of [390, 1280])
    test(`at ${width} px Settings scrolls in one place, its column, never the page`, async () => {
      await seed();
      const page = await app.open(width, "/settings");
      await page.getByText("What agents see").first().waitFor();
      await eventually(async () =>
        expect((await scrollers(page)).map((s) => s.name)).toEqual(["main"]),
      );
      const [main] = await scrollers(page);
      if (width === 1280) expect(main!.right - main!.left).toBeLessThanOrEqual(820);
    }, 30_000);
});
