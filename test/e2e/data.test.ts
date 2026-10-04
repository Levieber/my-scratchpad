// What is typed reaches the server, whatever happens to the connection or the tab, and whatever
// an agent writes meanwhile.
import { expect, test } from "bun:test";

import { describeE2E, eventually, openNote, useApp } from "@test/e2e/support";

import type { Note } from "@/shared/domain";

const BODY = "Write anything. Markdown welcome.";

/** The note with this body, once the server has it. */
const created = async (url: URL, body: string) => {
  const res = await fetch(new URL(`/api/notes?q=${encodeURIComponent(body)}`, url));
  const note = ((await res.json()) as Note[]).find((n) => n.body === body);
  if (!note) throw new Error(`no note "${body}" on the server yet`);
  return note;
};

describeE2E("edits are never lost", () => {
  const app = useApp();

  test("written offline, sent when the connection returns", async () => {
    const context = await app.context();
    const page = await context.newPage();
    await page.goto("/");
    await page.getByRole("button", { name: "+ New" }).click();

    await context.setOffline(true);
    await page.getByPlaceholder(BODY).fill("offline thoughts");
    await page.getByText("saved on this device").waitFor();
    expect(await page.getByText("1 change to sync").count()).toBe(1);

    await context.setOffline(false);
    await eventually(() => created(app.server.url, "offline thoughts"), 10_000);
    await page.getByText("1 change to sync").waitFor({ state: "detached" });
  }, 20_000);

  test("a tab closed while typing keeps the edit, and the next visit sends it", async () => {
    const context = await app.context();
    const page = await context.newPage();
    await page.goto("/");
    await page.getByRole("button", { name: "+ New" }).click();
    // Closed straight away: the 600 ms autosave never runs, only beforeunload does.
    await page.getByPlaceholder(BODY).fill("typed then closed");
    await page.close({ runBeforeUnload: true });

    const next = await context.newPage();
    await next.goto("/");
    await eventually(() => created(app.server.url, "typed then closed"), 10_000);
  }, 20_000);

  test("an agent appending while the note is open: both edits are kept", async () => {
    const note = await app.api.create({ body: "shared list\n- from the start" });
    const page = await app.open();
    await openNote(page, "shared list");
    await page.getByRole("tab", { name: "Write" }).click();

    // The agent's append lands between the editor's read and its save.
    let appended = false;
    await page.route(`**/api/notes/${note.id}`, async (route) => {
      if (route.request().method() === "PATCH" && !appended) {
        appended = true;
        await app.api.append(note.id, "- from the agent");
      }
      await route.continue();
    });
    await page.getByPlaceholder(BODY).fill("shared list\n- from the start\n- from the person");

    // Both added a line at the same spot: both lines are kept, with no conflict markers.
    await page.getByText("merged with changes made elsewhere").waitFor();
    const { body } = await app.api.get(note.id);
    expect(body).toBe("shared list\n- from the start\n- from the agent\n- from the person");
    expect(await page.getByPlaceholder(BODY).inputValue()).toBe(body);
  });
});
