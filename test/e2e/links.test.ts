// Links between notes in a real browser: `[[title]]` in the Read view opens the note it names,
// the note says who links to it, and a link to a title nobody has yet starts that note.
import { expect, test } from "bun:test";

import { describeE2E, eventually, openNote, useApp } from "@test/e2e/support";

describeE2E("links between notes", () => {
  const app = useApp();

  test("a link opens the note it names, which lists who links to it", async () => {
    await app.api.create({ title: "Link target", body: "the plan" });
    await app.api.create({ title: "Link source", body: "See [[link TARGET|the plan]] first." });
    const page = await app.open();
    await openNote(page, "Link source");
    await page.getByRole("tabpanel").getByRole("button", { name: "the plan" }).click();
    await eventually(async () =>
      expect(await page.getByPlaceholder("Title").inputValue()).toBe("Link target"),
    );
    const from = page.getByRole("navigation", { name: "Linked from" });
    await from.getByRole("button", { name: "Link source" }).click();
    await eventually(async () =>
      expect(await page.getByPlaceholder("Title").inputValue()).toBe("Link source"),
    );
  }, 20_000);

  test("a link to a title nobody has yet starts that note", async () => {
    await app.api.create({ title: "Link to nowhere", body: "Ideas: [[Someday project]]" });
    const page = await app.open();
    await openNote(page, "Link to nowhere");
    await page.getByRole("tabpanel").getByRole("button", { name: "Someday project" }).click();
    // The title is looked up first: type once the new note's body has the cursor.
    await eventually(async () =>
      expect(
        await page.evaluate(() => (document.activeElement as HTMLTextAreaElement | null)?.value),
      ).toBe("# Someday project\n\n"),
    );
    await page.keyboard.type("first thought");
    await eventually(async () => {
      const found = (await (
        await fetch(new URL("/api/notes?q=Someday", app.server.url))
      ).json()) as { title: string; body: string }[];
      expect(found.map((n) => n.title)).toContain("Someday project");
    }, 10_000);
  }, 20_000);
});
