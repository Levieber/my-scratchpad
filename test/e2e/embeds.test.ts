// A view embedded in a note (```pad-view) in a real browser: live in the Read view, by search or
// by a saved view's name, opening its notes, and fitting a phone.
import { expect, test } from "bun:test";

import { describeE2E, eventually, openNote, useApp, violations } from "@test/e2e/support";

const block = (lines: string) => "```pad-view\n" + lines + "\n```";

describeE2E("embedded views", () => {
  const app = useApp();

  test("shows its search's notes live, opens one, and opens as the search", async () => {
    await app.api.create({ title: "Embed one", body: "x", tags: ["embedded"] });
    await app.api.create({ title: "Embed two", body: "y", tags: ["embedded"] });
    await app.api.create({
      title: "Embed dashboard",
      body: `What is open:\n\n${block("query: #embedded\nlayout: grid")}`,
    });
    const page = await app.open();
    await openNote(page, "Embed dashboard");
    const embedded = page.getByRole("region", { name: "Embedded view: #embedded" });
    await embedded.getByRole("button", { name: "Embed one", exact: true }).waitFor();
    await embedded.getByRole("button", { name: "Embed two", exact: true }).waitFor();

    // An agent adds a note the search matches: it shows without a reload.
    await app.api.create({ title: "Embed three", body: "z", tags: ["embedded"] });
    await embedded.getByRole("button", { name: "Embed three", exact: true }).waitFor({
      timeout: 10_000,
    });

    await embedded.getByRole("button", { name: "Open as search" }).click();
    expect(await page.getByRole("searchbox").inputValue()).toBe("#embedded");
    await embedded.getByRole("button", { name: "Embed one", exact: true }).click();
    await eventually(async () =>
      expect(await page.getByPlaceholder("Title").inputValue()).toBe("Embed one"),
    );
  }, 25_000);

  test("by a saved view's name, and as text in Write", async () => {
    await fetch(new URL("/api/views", app.server.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Embed saved", query: "#embedsaved" }),
    });
    await app.api.create({ title: "Saved one", body: "x", tags: ["embedsaved"] });
    await app.api.create({ title: "Embed by name", body: block("view: embed SAVED") });
    await app.api.create({ title: "Embed nowhere", body: block("view: Nobody's view") });
    const page = await app.open(320);
    await openNote(page, "Embed by name");
    const embedded = page.getByRole("region", { name: "Embedded view: embed SAVED" });
    await embedded.getByRole("button", { name: /^Saved one/ }).waitFor();
    expect(await violations(page)).toEqual([]);

    await page.getByRole("tab", { name: "Write" }).click();
    expect(await page.getByRole("textbox", { name: /body/i }).inputValue()).toContain(
      "view: embed SAVED",
    );

    const other = await app.open();
    await openNote(other, "Embed nowhere");
    await other.getByText("No saved view is named “Nobody's view”.").waitFor();
  }, 25_000);
});
