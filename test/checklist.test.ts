import { describe, expect, test } from "bun:test";

import { openItems, progress } from "../src/checklist";
import { dailyBody, dailyTitle, isDate, localDate } from "../src/daily";

describe("progress", () => {
  test("counts ticked and total checkboxes in any list style", () => {
    const body =
      "- [x] one\n* [ ] two\n  - [X] nested\n1. [ ] numbered\nplain line\n- [] not a box";
    expect(progress(body)).toEqual({ done: 2, total: 4 });
  });

  test("ignores empty placeholder checkboxes", () => {
    expect(progress("- [ ] \n- [x]\n- [ ] real")).toEqual({ done: 0, total: 1 });
  });

  test("ignores checkboxes inside code fences", () => {
    expect(progress("- [ ] real\n```md\n- [x] example\n```")).toEqual({ done: 0, total: 1 });
  });

  test("a note without checkboxes has none", () => {
    expect(progress("just text")).toEqual({ done: 0, total: 0 });
  });
});

describe("openItems", () => {
  test("returns the text of unticked, non-empty items", () => {
    expect(openItems("- [ ] ship it\n- [x] done\n- [ ] \n  - [ ] nested one")).toEqual([
      "ship it",
      "nested one",
    ]);
  });
});

describe("daily", () => {
  test("title and date checks", () => {
    expect(dailyTitle("2026-09-25")).toBe("Daily review 2026-09-25");
    expect(isDate("2026-09-25")).toBe(true);
    expect(isDate("2026-02-30")).toBe(false);
    expect(isDate("today")).toBe(false);
    expect(localDate(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });

  test("the template carries over open items, or leaves an empty one", () => {
    expect(dailyBody(["ship it"])).toContain("## Carried over\n- [ ] ship it\n");
    expect(dailyBody([])).not.toContain("Carried over");
    expect(dailyBody([])).toContain("## Tomorrow\n- [ ] ");
  });
});
