// The Pages layout with more notes at the top than a page loads: it says so rather than showing
// a silent part of them. A page with dozens of subpages still leaves room for its own text.
import { expect, test } from "bun:test";

import { describeE2E, eventually, useApp } from "@test/e2e/support";

describeE2E("pages tree", () => {
  const app = useApp();

  test("the top of the tree says when it shows only the most recent notes", async () => {
    for (let i = 0; i < 205; i++) await app.api.create({ body: `# Loose note ${i}` });
    const page = await app.open(1280, "/?layout=pages");
    await eventually(async () =>
      expect(await page.getByText(/most recently changed/).count()).toBe(1),
    );
    expect(
      await page.getByRole("list", { name: "Pages" }).getByRole("listitem").count(),
    ).toBeLessThan(205);
  }, 60_000);

  test("dozens of subpages scroll beside the note on a phone, not over its editor", async () => {
    const project = await app.api.create({ title: "Busy project", body: "the plan" });
    for (let i = 0; i < 30; i++)
      await app.api.create({
        title: `Plan ${i}: a title long enough to take a line of its own`,
        body: "x",
        parent_id: project.id,
      });
    const page = await app.open(390, `/?note=${project.id}`);
    const subpages = page.getByRole("navigation", { name: "Subpages" });
    await subpages.getByRole("button", { name: /^Plan 29/ }).waitFor();
    const editor = await page.getByRole("tabpanel").boundingBox();
    expect(editor!.height).toBeGreaterThan(200);
    // The last of them, and the button that adds one, are a scroll away, not off the screen.
    const add = subpages.getByRole("button", { name: "Subpage" });
    await add.scrollIntoViewIfNeeded();
    const box = (await add.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(800);
  }, 30_000);
});
