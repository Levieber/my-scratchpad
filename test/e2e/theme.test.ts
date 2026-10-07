// The theme switcher: System follows the device, Light and Dark override it, and the device
// remembers the choice across visits.
import { expect, test } from "bun:test";

import { describeE2E, eventually, useApp, violations } from "@test/e2e/support";
import type { Page } from "playwright-core";

// index.css: the light and the dark palette's --background.
const LIGHT = "rgb(247, 246, 243)";
const DARK = "rgb(26, 26, 25)";

const background = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

const choose = (page: Page, name: string) =>
  page.getByRole("group", { name: "Theme" }).getByRole("button", { name, exact: true }).click();

describeE2E("theme", () => {
  const app = useApp();

  test("Dark over a light device, remembered on the next visit", async () => {
    const page = await app.open();
    await page.emulateMedia({ colorScheme: "light" });
    expect(await background(page)).toBe(LIGHT);

    await choose(page, "Dark");
    await eventually(async () => expect(await background(page)).toBe(DARK));
    await page.reload();
    await page.getByRole("navigation", { name: "Notes" }).waitFor();
    expect(await background(page)).toBe(DARK);
    expect(
      await page
        .getByRole("group", { name: "Theme" })
        .getByRole("button", { name: "Dark", exact: true })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  test("Light over a dark device, and System gives it back to the device", async () => {
    const page = await app.open();
    await page.emulateMedia({ colorScheme: "dark" });
    expect(await background(page)).toBe(DARK);

    await choose(page, "Light");
    await eventually(async () => expect(await background(page)).toBe(LIGHT));
    // Native parts (scrollbars, fields' own widgets) follow too.
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(
      "light",
    );

    await choose(page, "System");
    await eventually(async () => expect(await background(page)).toBe(DARK));
  });

  test("the address bar's color follows the chosen theme", async () => {
    const page = await app.open();
    await page.emulateMedia({ colorScheme: "light" });
    await choose(page, "Dark");
    const colors = await page.$$eval('meta[name="theme-color"]', (metas) =>
      metas.map((m) => m.getAttribute("content")),
    );
    expect(colors).toEqual(["#1a1a19", "#1a1a19"]);
  });

  for (const width of [320, 390])
    test(`at ${width} px the footer holds the switcher: no sideways scroll, 24 px targets`, async () => {
      const page = await app.open(width);
      await page.getByRole("group", { name: "Theme" }).waitFor();
      expect(await violations(page)).toEqual([]);
    });
});
