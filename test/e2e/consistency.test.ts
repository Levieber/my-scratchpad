// The same role looks and behaves the same wherever it appears: the links in the list's footer,
// a toggle's name, an icon-only button's explanation.
import { expect, test } from "bun:test";

import { describeE2E, eventually, row, useApp } from "@test/e2e/support";
import type { Locator, Page } from "playwright-core";

/** What makes two links look alike, as the browser draws them. */
const look = (el: Locator) =>
  el.evaluate((node) => {
    const s = getComputedStyle(node);
    return {
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
      color: s.color,
      decoration: s.textDecorationLine,
      decorationColor: s.textDecorationColor,
      offset: s.textUnderlineOffset,
      height: Math.round(node.getBoundingClientRect().height),
    };
  });

/** The visible buttons named only by an aria-label: icons, no text of their own. */
const iconOnly = (page: Page) =>
  page.locator("button[aria-label]:not([aria-haspopup])").filter({ hasNotText: /\S/ }).all();

describeE2E("consistency", () => {
  const app = useApp();

  test("the footer's Export, Settings and API look alike", async () => {
    await app.api.create({ title: "Footer" });
    const page = await app.open();
    const footer = page.locator("aside footer");
    const [exportAll, settings, api] = await Promise.all(
      [
        footer.getByRole("button", { name: "Export all" }),
        footer.getByRole("link", { name: "Settings" }),
        footer.getByRole("link", { name: "API" }),
      ].map(look),
    );
    expect(exportAll).toEqual(settings);
    expect(api).toEqual(settings);
  });

  test("the editor's Pin keeps its name when pressed: the state is aria-pressed's", async () => {
    const note = await app.api.create({ title: "Pin me" });
    const page = await app.open(1280, `/?note=${note.id}`);
    const toolbar = page.locator("main header, header").filter({ has: page.getByLabel("Title") });
    const pin = toolbar.getByRole("button", { name: "Pin", exact: true });
    expect(await pin.getAttribute("aria-pressed")).toBe("false");
    await pin.click();
    await eventually(async () => expect(await pin.getAttribute("aria-pressed")).toBe("true"));
  });

  test("the board's Columns picker is a chip, like the chips above the notes", async () => {
    await app.api.create({ title: "Board chip", tags: ["chipped"] });
    const page = await app.open(1280, "/?layout=board");
    const shape = (el: Locator) =>
      el.evaluate((node) => {
        const s = getComputedStyle(node);
        return {
          radius: s.borderRadius,
          fontSize: s.fontSize,
          height: Math.round(node.getBoundingClientRect().height),
        };
      });
    const tag = page.getByRole("group", { name: "Tags", exact: true }).getByRole("button").first();
    const columns = page.locator("button[aria-haspopup]", { hasText: /^Columns/ });
    expect(await shape(columns)).toEqual(await shape(tag));
  });

  for (const beside of [false, true])
    test(`${beside ? "beside an open note" : "in the whole-screen list"}, a pinned note's row looks like any other note's`, async () => {
      const body = "The same body, so the two rows have the same preview to show.";
      const tag = beside ? "beside" : "whole";
      const pinned = await app.api.create({ title: `Twin pinned ${tag}`, body });
      await app.api.create({ title: `Twin listed ${tag}`, body });
      await fetch(new URL(`/api/pins/${pinned.id}`, app.server.url), { method: "PUT" });
      const open = beside ? await app.api.create({ title: "The open one" }) : null;
      const page = await app.open(1280, open ? `/?note=${open.id}` : "/");
      const height = async (title: string) => {
        const r = row(page, title);
        await r.waitFor();
        return r.evaluate((el) => Math.round(el.getBoundingClientRect().height));
      };
      expect(await height(`Twin pinned ${tag}`)).toBe(await height(`Twin listed ${tag}`));
      expect(await row(page, `Twin pinned ${tag}`).innerText()).toContain(body);
    });

  for (const [name, path] of [
    ["the list", "/"],
    ["a note", "/?note="],
    ["Settings", "/settings"],
  ] as const)
    test(`every icon-only button in ${name} explains itself on hover`, async () => {
      const note = await app.api.create({ title: "Icons" });
      await fetch(new URL("/api/views", app.server.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: `Icons ${name}`, query: "#icons" }),
      });
      const page = await app.open(1280, path.endsWith("=") ? path + note.id : path);
      await page.locator("main, nav").first().waitFor();
      const silent: string[] = [];
      for (const button of await iconOnly(page)) {
        if (!(await button.isVisible())) continue;
        await button.hover();
        const label = await button.getAttribute("aria-label");
        // Base UI draws the tooltip for the eye only (the name is the aria-label): no role.
        const tip = page.locator("[data-slot=tooltip-content][data-open]");
        if (
          !(await tip.waitFor({ timeout: 1500 }).then(
            () => true,
            () => false,
          ))
        )
          silent.push(label ?? "");
        await page.mouse.move(0, 0);
        await tip.waitFor({ state: "hidden" }).catch(() => {});
      }
      expect(silent).toEqual([]);
    }, 60_000);
});
