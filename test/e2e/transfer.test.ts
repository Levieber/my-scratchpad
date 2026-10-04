// Export and import in a real browser: the file the browser saves, the file it sends back, and
// what the page shows meanwhile.
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describeE2E, eventually, row, useApp } from "@test/e2e/support";
import type { Download, Page } from "playwright-core";

import type { ExportArchive } from "@/shared/archive";

describeE2E("export and import", () => {
  const app = useApp();
  const dir = mkdtempSync(join(tmpdir(), "pad-e2e-transfer-"));

  const saved = async (download: Download) =>
    (await Bun.file((await download.path())!).json()) as ExportArchive;

  const settings = async () => {
    const page = await app.open(1280, "/settings");
    await page.getByRole("heading", { name: "Data" }).waitFor();
    return page;
  };

  const remove = (id: string) =>
    fetch(new URL(`/api/notes/${id}`, app.server.url), { method: "DELETE" });

  const importFile = (
    page: Page,
    file: string | { name: string; mimeType: string; buffer: Buffer },
  ) => page.locator('input[type="file"]').setInputFiles(file);

  test("Settings saves every note with its history, and a file without history on request", async () => {
    const note = await app.api.create({ title: "Export me", body: "first" });
    const page = await settings();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export all" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^pad-export-\d{4}-\d{2}-\d{2}\.json$/);
    const archive = await saved(download);
    expect(archive).toMatchObject({ format: "pad-export", version: 2 });
    const exported = archive.notes.find((n) => n.id === note.id);
    expect(exported?.revisions?.length).toBeGreaterThan(0);

    await page.getByRole("checkbox", { name: "Include history" }).click();
    const [bare] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export all" }).click(),
    ]);
    const without = (await saved(bare)).notes.find((n) => n.id === note.id);
    expect(without).toBeDefined();
    expect(without).not.toHaveProperty("revisions");
  });

  test("importing a saved file brings back a deleted note, and importing it again changes nothing", async () => {
    const note = await app.api.create({ title: "Come back", body: "still here" });
    const page = await settings();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export all" }).click(),
    ]);
    const file = join(dir, "backup.json");
    await download.saveAs(file);
    await remove(note.id);
    expect((await fetch(new URL(`/api/notes/${note.id}`, app.server.url))).status).toBe(404);

    await importFile(page, file);
    await page.getByRole("status").filter({ hasText: "imported" }).waitFor();
    expect((await app.api.get(note.id)).body).toBe("still here");

    await importFile(page, file);
    await page.getByRole("status").filter({ hasText: "already here and left as" }).waitFor();
    // The list behind Settings is asked again after an import.
    await page.goto("/");
    await row(page, "Come back").waitFor();
  });

  test("a file that is not JSON is refused with a sentence, and nothing is sent", async () => {
    const page = await settings();
    let sent = 0;
    await page.route("**/api/import", (route) => {
      if (route.request().method() === "POST") sent++;
      return route.fallback();
    });
    await importFile(page, {
      name: "notes.json",
      mimeType: "application/json",
      buffer: Buffer.from("nope"),
    });
    await page.getByRole("alert").filter({ hasText: "not a JSON file" }).waitFor();
    expect(sent).toBe(0);
  });

  test("a file from a newer version shows the server's refusal", async () => {
    const page = await settings();
    const buffer = Buffer.from(JSON.stringify({ format: "pad-export", version: 99, notes: [] }));
    await importFile(page, { name: "future.json", mimeType: "application/json", buffer });
    await page.getByRole("alert").filter({ hasText: "up to version 2" }).waitFor();
  });

  test("a server that can't import shows no Data section at all", async () => {
    const context = await app.context();
    const page = await context.newPage();
    await page.route("**/api/import", (route) =>
      route.request().method() === "GET"
        ? route.fulfill({ status: 404, json: { error: "notFound", message: "No such endpoint" } })
        : route.fallback(),
    );
    await page.goto("/settings");
    await page.getByRole("heading", { name: "Agents" }).waitFor();
    await Bun.sleep(300);
    expect(await page.getByRole("heading", { name: "Data" }).count()).toBe(0);
    expect(await page.getByRole("button", { name: /Export/ }).count()).toBe(0);
  });

  test("the list's footer exports what the search lists", async () => {
    const zebra = await app.api.create({ title: "Zebra crossing", body: "stripes" });
    await app.api.create({ title: "Unrelated thing", body: "plain" });
    const page = await app.open();
    await page.getByRole("searchbox").fill("zebra");
    await row(page, "Zebra crossing").waitFor();
    await eventually(async () => expect(await row(page, "Unrelated thing").count()).toBe(0));

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export these" }).click(),
    ]);
    const archive = await saved(download);
    expect(archive.notes.map((n) => n.id)).toEqual([zebra.id]);
    // A subset: the user's views and hook choices are not part of it.
    expect([archive.views, archive.hook_selections]).toEqual([[], []]);
  });

  test("when the server can't be reached the buttons are disabled, with the reason", async () => {
    const page = await settings();
    await page.route("**/api/export*", (route) => route.abort());
    await page.getByRole("button", { name: "Export all" }).click();
    await eventually(async () =>
      expect(await page.getByRole("button", { name: "Export all" }).isDisabled()).toBe(true),
    );
    await page.getByText("Export and import need the server.").waitFor();
  });
});
