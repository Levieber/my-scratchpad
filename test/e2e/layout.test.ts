// The rules a phone and its owner's settings need, measured on the rendered page rather than
// approximated from the CSS (test/web/styles.test.ts holds what the CSS alone can prove).
import { expect, test } from "bun:test";

import { describeE2E, eventually, openNote, useApp } from "@test/e2e/support";
import type { Page } from "playwright-core";

const WIDTHS = [320, 390, 1280];

// What a pointer or a finger aims at. An inline link in a sentence would be exempt (WCAG 2.5.8);
// the app has none.
const TARGETS =
  "button, a[href], input, textarea, select, [role=button], [role=link], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=radio], [role=checkbox], [role=switch], [role=tab], [role=option]";

/** Whatever on the page breaks a rule, as readable lines; empty when it all holds. */
const violations = (page: Page) =>
  page.evaluate((targets) => {
    const found: string[] = [];
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth)
      found.push(`scrolls sideways: ${root.scrollWidth} > ${root.clientWidth}`);
    for (const el of document.querySelectorAll<HTMLElement>(targets)) {
      if (!el.checkVisibility({ visibilityProperty: true })) continue;
      const box = el.getBoundingClientRect();
      const name = `${el.tagName.toLowerCase()} "${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30) ?? ""}"`;
      if (box.width < 24 || box.height < 24)
        found.push(`${name} is ${Math.round(box.width)}x${Math.round(box.height)}`);
      if (el.matches("input, textarea, select")) {
        const size = parseFloat(getComputedStyle(el).fontSize);
        if (size < 16) found.push(`${name} has a ${size}px font`);
      }
    }
    return found;
  }, TARGETS);

describeE2E("layout", () => {
  const app = useApp();

  for (const width of WIDTHS)
    test(`at ${width} px: no sideways scroll, 24 px targets, 16 px fields`, async () => {
      await app.api.create({
        title: `A long title that has to wrap somewhere on a phone ${width}`,
        body: "- [ ] one\n- [x] two",
        tags: ["layout", "a-rather-long-tag-name"],
        kind: "reference",
      });
      const page = await app.open(width);
      const screens: Record<string, string[]> = {};
      screens.list = await violations(page);

      await page.getByRole("searchbox").fill("long title");
      await page.getByRole("button", { name: "Save this search" }).click();
      screens["naming a view"] = await violations(page);
      await page.keyboard.press("Escape");
      await page.getByRole("searchbox").fill("");

      await page
        .getByRole("button", { name: /^Options for/ })
        .first()
        .click();
      await page.getByRole("menu").waitFor();
      screens.menu = await violations(page);
      await page.keyboard.press("Escape");

      await openNote(page, `A long title that has to wrap somewhere on a phone ${width}`);
      await page.getByPlaceholder("Title").waitFor();
      screens.editor = await violations(page);

      await page.getByRole("button", { name: "Delete" }).click();
      await page.getByRole("alertdialog").waitFor();
      screens["delete dialog"] = await violations(page);
      await page.getByRole("button", { name: "Cancel" }).click();
      await page.getByRole("alertdialog").waitFor({ state: "detached" });

      await page.getByRole("button", { name: "History" }).click();
      await page.getByRole("region", { name: "History" }).waitFor();
      screens.history = await violations(page);

      await page.goto("/settings");
      await page.getByRole("heading", { name: "Settings" }).waitFor();
      await page.getByText("What agents see").first().waitFor();
      screens.settings = await violations(page);

      expect(screens).toEqual({
        list: [],
        "naming a view": [],
        menu: [],
        editor: [],
        "delete dialog": [],
        history: [],
        settings: [],
      });
    });

  test("keyboard only: from the list to the editor, then delete the note", async () => {
    const note = await app.api.create({ body: "keyboard only" });
    const page = await app.open();
    const focused = () =>
      page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el?.getAttribute("aria-label") ?? el?.innerText ?? "";
      });
    /** Tabs forward until the focused element's name passes `test`. */
    const tabTo = async (test: (name: string) => boolean) => {
      for (let i = 0; i < 60; i++) {
        await page.keyboard.press("Tab");
        if (test(await focused())) return;
      }
      throw new Error("never reached by Tab");
    };

    await tabTo((name) => name.startsWith("keyboard only"));
    await page.keyboard.press("Enter");
    await page.getByPlaceholder("Title").waitFor();
    expect(await page.getByPlaceholder("Write anything. Markdown welcome.").inputValue()).toBe(
      "keyboard only",
    );

    await tabTo((name) => name === "Delete");
    await page.keyboard.press("Enter");
    // A dialog of the page (not the browser's confirm): focus moves into it and stays there.
    const dialog = page.getByRole("alertdialog");
    await dialog.waitFor();
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    await tabTo((name) => name === "Delete");
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Enter");
    await page.getByPlaceholder("Title").waitFor({ state: "detached" });
    await eventually(() => expect(app.api.get(note.id)).rejects.toThrow(/404/));
  });
});
