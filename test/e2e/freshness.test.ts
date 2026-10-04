// What the server says arrives late and out of order on a slow network: an answer must never put
// back something older than what is already on screen.
import { expect, test } from "bun:test";

import {
  describeE2E,
  eventually,
  holdNextList,
  LIST,
  openNote,
  poll,
  row,
  useApp,
} from "@test/e2e/support";

// `test.failing` until the list drops stale answers (issue #3, phase 1): these show the bug.
describeE2E("a slow network", () => {
  const app = useApp();

  test.failing("a late list response doesn't overwrite a newer one", async () => {
    await app.api.create({ body: "alpha one" });
    await app.api.create({ body: "zeta two" });
    const page = await (await app.context()).newPage();
    // The first list (everything) is answered after the search's.
    const first = await holdNextList(page);
    await page.goto("/");
    await first.started;
    await page.getByRole("searchbox").fill("zeta");
    await row(page, "zeta two").waitFor();

    await first.release();
    await Bun.sleep(400);
    expect(await row(page, "alpha one").count()).toBe(0);
    expect(await row(page, "zeta two").count()).toBe(1);
  });

  test.failing("the open note is replaced only by a newer version", async () => {
    const note = await app.api.create({ body: "first draft" });
    const page = await app.open();
    await openNote(page, "first draft");
    const body = page.getByPlaceholder("Write anything. Markdown welcome.");
    expect(await body.inputValue()).toBe("first draft");

    // A refresh starts, and its answer (the note as it was) is slow to arrive.
    const stale = await holdNextList(page);
    await poll(page);
    await stale.started;

    await body.fill("second draft");
    await page.getByPlaceholder("Title").focus();
    await eventually(async () => expect((await app.api.get(note.id)).body).toBe("second draft"));
    await page.getByRole("status").filter({ hasText: "saved" }).waitFor();

    await stale.release();
    await Bun.sleep(400);
    expect(await body.inputValue()).toBe("second draft");
  });

  test.failing(
    "ticking a checklist box: the n/m counter never goes back",
    async () => {
      await app.api.create({ title: "Chores", body: "- [ ] dishes\n- [ ] laundry" });
      const page = await app.open();
      const counter = row(page, "Chores");
      await counter.getByText("0/2").waitFor();
      // Every value the row's details take, in order, however briefly.
      await counter.evaluate((li) => {
        const seen: string[] = [];
        (window as unknown as { seen: string[] }).seen = seen;
        const record = () => {
          const text = /\d+\/\d+/.exec(li.textContent ?? "")?.[0];
          if (text && seen.at(-1) !== text) seen.push(text);
        };
        record();
        new MutationObserver(record).observe(li, {
          subtree: true,
          childList: true,
          characterData: true,
        });
      });

      // Every list answer takes 700 ms to arrive, and holds what the server had when asked.
      await page.route(LIST, async (route) => {
        const response = await route.fetch();
        await Bun.sleep(700);
        await route.fulfill({ response });
      });
      await openNote(page, "Chores");
      await page
        .getByPlaceholder("Write anything. Markdown welcome.")
        .fill("- [x] dishes\n- [ ] laundry");
      await page.getByPlaceholder("Title").focus();
      for (let i = 0; i < 4; i++) {
        await Bun.sleep(500);
        await poll(page);
      }
      await Bun.sleep(1_000);

      const seen = await page.evaluate(() => (window as unknown as { seen: string[] }).seen);
      expect(seen).toEqual(["0/2", "1/2"]);
    },
    15_000,
  );
});
