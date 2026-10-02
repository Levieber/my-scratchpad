import { describe, expect, test } from "bun:test";

import { progress } from "../src/checklist";

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
