// Forms say what went wrong where a screen reader finds it: the error is the field's description.
import { expect, test } from "bun:test";

import { describeE2E, useApp } from "@test/e2e/support";
import type { Locator } from "playwright-core";

/** The field's accessible description: the text of what its aria-describedby names. */
const description = (field: Locator) =>
  field.evaluate((el) =>
    (el.getAttribute("aria-describedby") ?? "")
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim(),
  );

describeE2E("forms", () => {
  const app = useApp();

  test("a view name already taken: said on the field, which keeps the popover open", async () => {
    const page = await app.open();
    const save = async (name: string) => {
      await page.getByRole("button", { name: "Save this search" }).click();
      const field = page.getByRole("textbox", { name: "View name" });
      await field.fill(name);
      await page.keyboard.press("Enter");
      return field;
    };

    await page.getByRole("searchbox").fill("#work");
    await (await save("Work")).waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Work", exact: true }).waitFor();

    await page.getByRole("searchbox").fill("#work kind:note");
    const field = await save("Work");
    await page.getByText("A view with this name already exists").waitFor();
    expect(await field.getAttribute("aria-invalid")).toBe("true");
    expect(await description(field)).toBe("A view with this name already exists");
  });
});
