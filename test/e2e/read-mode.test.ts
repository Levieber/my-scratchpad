// Notes for people who don't know markdown: the Read view ticks items, the Write view
// helps with the syntax. Whatever either does, the body stays the markdown it was, changed only
// where the person acted.
import { expect, test } from "bun:test";

import { describeE2E, eventually, openNote, poll, row, useApp } from "@test/e2e/support";

const BODY = "Write anything. Markdown welcome.";

describeE2E("Read and Write", () => {
  const app = useApp();

  test("a tick changes one line on the server, past an empty placeholder", async () => {
    const note = await app.api.create({
      body: "Trip\n\n- [ ] passport\n- [ ]\n- [ ] charger\n\nend",
    });
    const page = await app.open();
    await openNote(page, "Trip");
    await page.getByRole("checkbox", { name: "charger" }).click();
    await eventually(async () =>
      expect((await app.api.get(note.id)).body).toBe(
        "Trip\n\n- [ ] passport\n- [ ]\n- [x] charger\n\nend",
      ),
    );
    await row(page, "Trip").getByText("1/2").waitFor();
  });

  test("ticked offline, sent when the connection returns", async () => {
    const note = await app.api.create({ body: "Offline list\n- [ ] one\n- [ ] two" });
    const context = await app.context();
    const page = await context.newPage();
    await page.goto("/");
    await openNote(page, "Offline list");

    await context.setOffline(true);
    await page.getByRole("checkbox", { name: "two" }).click();
    await page.getByText("saved on this device").waitFor();
    expect(await page.getByRole("checkbox", { name: "two" }).getAttribute("aria-checked")).toBe(
      "true",
    );

    await context.setOffline(false);
    await eventually(
      async () =>
        expect((await app.api.get(note.id)).body).toBe("Offline list\n- [ ] one\n- [x] two"),
      10_000,
    );
  }, 20_000);

  test("an agent's append shows up in the Read view while it is open", async () => {
    const note = await app.api.create({ body: "Agent log\n- [ ] first" });
    const page = await app.open();
    await openNote(page, "Agent log");
    await page.getByRole("checkbox", { name: "first" }).waitFor();
    await app.api.append(note.id, "- [ ] from the agent");
    await poll(page);
    await page.getByRole("checkbox", { name: "from the agent" }).waitFor();
  });

  test("existing notes open in Read until Write is picked; then this device opens them in Write", async () => {
    await app.api.create({ body: "Mode memory" });
    const page = await app.open();
    await openNote(page, "Mode memory");
    expect(await page.getByRole("tab", { name: "Read" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    await page.getByRole("tab", { name: "Write" }).click();
    await page.reload();
    await openNote(page, "Mode memory");
    expect(await page.getByPlaceholder(BODY).inputValue()).toBe("Mode memory");
    // A new note opens in Write whatever was picked.
    await page.getByRole("tab", { name: "Read" }).click();
    await page.getByRole("button", { name: "+ New" }).click();
    await page.getByPlaceholder(BODY).waitFor();
  });

  test("the Write view's helpers: a checklist, Enter for the next item, Enter again to end it, bold", async () => {
    const page = await app.open();
    await page.getByRole("button", { name: "+ New" }).click();
    const body = page.getByPlaceholder(BODY);
    await body.focus();
    await page.getByRole("button", { name: "Checklist" }).click();
    await page.keyboard.type("milk");
    await page.keyboard.press("Enter");
    await page.keyboard.type("eggs");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("done");
    await page.keyboard.press("Shift+Home");
    await page.keyboard.press("ControlOrMeta+b");
    expect(await body.inputValue()).toBe("- [ ] milk\n- [ ] eggs\n**done**");
    // Ctrl+K in the body makes a link rather than going to the search.
    await page.keyboard.press("End");
    await page.keyboard.press("ControlOrMeta+k");
    expect(await body.inputValue()).toBe("- [ ] milk\n- [ ] eggs\n**done**[](url)");
    expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe(
      "Body",
    );
  });
});
