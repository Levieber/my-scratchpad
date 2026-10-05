// The Pages layout with more notes at the top than a page loads: it says so rather than showing
// a silent part of them.
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
});
