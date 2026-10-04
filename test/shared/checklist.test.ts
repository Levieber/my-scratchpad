import { describe, expect, test } from "bun:test";

import { progress, tasks } from "@/shared/checklist";

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

describe("tasks", () => {
  test("each task's line, in order, skipping fences and empty placeholders", () => {
    const body = "# Plan\n- [ ]\n- [x] one\n```\n- [ ] example\n```\n  - [ ] two";
    expect(tasks(body)).toEqual([
      { line: 2, done: true },
      { line: 6, done: false },
    ]);
  });

  // The Read view maps its Nth rendered box to the Nth of these, so a fence must close where
  // CommonMark closes it, or a click edits a line inside a code block.
  describe("fences close as CommonMark closes them", () => {
    const lines = (body: string) => tasks(body).map((t) => t.line);

    test("a longer fence holds a shorter one", () => {
      expect(lines("````\n```\n- [ ] fake\n````\n- [ ] real")).toEqual([4]);
    });

    test("a tilde fence is a fence, and a backtick fence inside it is only text", () => {
      expect(lines("~~~\n```\n- [ ] fake\n~~~\n- [ ] real")).toEqual([4]);
    });

    test("only the same character closes, with no text after it", () => {
      expect(lines("```\n~~~\n- [ ] fake\n``` ts\n- [ ] still fake\n```\n- [ ] real")).toEqual([6]);
    });

    test("a fence left open runs to the end of the body", () => {
      expect(lines("- [ ] real\n```\n- [ ] fake")).toEqual([0]);
    });

    test("a fence inside a list item or an indented fence still counts", () => {
      expect(lines("- item\n  ```\n  - [ ] fake\n  ```\n- [ ] real")).toEqual([4]);
    });
  });
});
