// The PWA as it ships: in chunks (scripts/builds.ts), what opens later loaded when it opens, so a
// browser doesn't run code it may never need. Offline it must still open: the page names those
// chunks as prefetches (server/pages.ts), and the service worker caches them before they are used.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { web } from "@scripts/builds";
import { describeE2E, eventually, openNote, useApp } from "@test/e2e/support";

describeE2E("the PWA in chunks", () => {
  const dir = mkdtempSync(join(tmpdir(), "pad-chunks-"));
  const app = useApp({
    prebuilt: async () => {
      const build = await Bun.build(web(dir));
      if (!build.success) throw new AggregateError(build.logs, "the PWA didn't build");
      return dir;
    },
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("the Read view, History and Settings open offline, though never opened online", async () => {
    await app.api.create({ body: "Chunked\n\n- [ ] a box" });
    // Service workers allowed, unlike the other tests' contexts.
    const context = await app.browser.newContext({ baseURL: app.server.url.href });
    const page = await context.newPage();
    await page.goto("/");
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    // The device's next visit: the worker answers now, and caches what the page prefetches.
    await page.reload();
    await page.getByRole("navigation", { name: "Notes" }).waitFor();
    const lazy = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLLinkElement>("link[rel=prefetch]")].map(
        (l) => new URL(l.href).pathname,
      ),
    );
    expect(lazy.length).toBeGreaterThanOrEqual(4);
    await eventually(
      async () =>
        expect(
          await page.evaluate(
            async (paths) => (await Promise.all(paths.map((p) => caches.match(p)))).every(Boolean),
            lazy,
          ),
        ).toBe(true),
      10_000,
    );

    await context.setOffline(true);
    await openNote(page, "Chunked");
    // The Read view's renderer is a chunk of its own.
    await page.getByRole("checkbox", { name: "a box" }).waitFor();
    // So is History, which says so itself: its revisions were never fetched online.
    await page.getByRole("button", { name: "History" }).click();
    await page.getByText("History needs a connection.").waitFor();
    await page.getByRole("link", { name: "Settings" }).click();
    await page.getByRole("heading", { name: "Settings" }).waitFor();
    await context.close();
  }, 30_000);
});
