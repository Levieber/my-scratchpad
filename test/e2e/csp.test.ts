// The PWA under its Content-Security-Policy (server/pages.ts), with the service worker running as
// it does for real: nothing the app needs is refused.
import { expect, test } from "bun:test";

import { describeE2E, useApp } from "@test/e2e/support";

describeE2E("Content-Security-Policy", () => {
  const app = useApp();

  test("refuses nothing the app does: service worker, manifest, icons, a rendered note", async () => {
    await app.api.create({
      body: "CSP check\n\n- [ ] a box\n\n<script>window.ran = true</script>\n\n![pic](https://example.com/x.png)",
    });
    // Service workers allowed, unlike the other tests' contexts.
    const context = await app.browser.newContext({ baseURL: app.server.url.href });
    const page = await context.newPage();
    const refused: string[] = [];
    page.on("console", (m) => {
      if (/Content Security Policy/i.test(m.text())) refused.push(m.text());
    });
    await page.addInitScript(() =>
      document.addEventListener("securitypolicyviolation", (e) =>
        console.error(`Content Security Policy: ${e.violatedDirective} ${e.blockedURI}`),
      ),
    );
    await page.goto("/");
    await page.getByRole("navigation", { name: "Notes" }).waitFor();

    // `ready` resolves once there is an active worker, which may still be "activating" while its
    // activate handler (cache cleanup, clients.claim) runs: wait for it to finish, not just start.
    expect(
      await page.evaluate(async () => {
        const worker = (await navigator.serviceWorker.ready).active;
        if (!worker || worker.state === "activated") return worker?.state;
        return new Promise<string>((resolve) =>
          worker.addEventListener("statechange", () => {
            if (worker.state !== "activating") resolve(worker.state);
          }),
        );
      }),
    ).toBe("activated");
    const loaded = await page.evaluate(async () =>
      Promise.all(
        [
          ...document.querySelectorAll<HTMLLinkElement>(
            "link[rel=icon], link[rel=manifest], link[rel=apple-touch-icon]",
          ),
        ].map(async (l) => [l.rel, (await fetch(l.href)).status] as const),
      ),
    );
    expect(loaded.map(([rel]) => rel).sort()).toEqual(["apple-touch-icon", "icon", "manifest"]);
    expect(loaded.every(([, status]) => status === 200)).toBe(true);

    await page
      .getByRole("button", { name: /^CSP check/ })
      .first()
      .click();
    await page.getByRole("checkbox", { name: "a box" }).waitFor();
    // The script in the body is text; the image a link, never fetched.
    await page.getByRole("tabpanel").getByText("<script>window.ran = true</script>").waitFor();
    expect(await page.evaluate(() => (window as { ran?: boolean }).ran)).toBeUndefined();
    await page.getByRole("link", { name: "pic" }).waitFor();

    expect(refused).toEqual([]);
    await context.close();
  }, 20_000);
});
