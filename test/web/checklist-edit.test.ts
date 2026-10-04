import { describe, expect, test } from "bun:test";

import { progress } from "@/shared/checklist";
import { diffStats } from "@/shared/diff/lines";
import { toggleTask } from "@/web/lib/checklist-edit";

describe("toggleTask", () => {
  test("ticks and unticks the nth task, changing nothing else", () => {
    const body = "Groceries\n\n- [ ] milk\n* [X] eggs\n1. [ ] bread\n";
    expect(toggleTask(body, 0)).toBe("Groceries\n\n- [x] milk\n* [X] eggs\n1. [ ] bread\n");
    expect(toggleTask(body, 1)).toBe("Groceries\n\n- [ ] milk\n* [ ] eggs\n1. [ ] bread\n");
    expect(toggleTask(body, 2)).toBe("Groceries\n\n- [ ] milk\n* [X] eggs\n1. [x] bread\n");
  });

  test("counts tasks as progress does: an empty placeholder or a fenced example isn't one", () => {
    const body = "- [ ]\n- [ ] \n```\n- [ ] example\n```\n- [ ] real\n- [ ] next";
    expect(toggleTask(body, 0)).toBe(
      "- [ ]\n- [ ] \n```\n- [ ] example\n```\n- [x] real\n- [ ] next",
    );
    expect(progress(toggleTask(body, 1)!)).toEqual({ done: 1, total: 2 });
  });

  test("a task that no longer exists changes nothing", () => {
    expect(toggleTask("- [ ] only", 1)).toBeNull();
    expect(toggleTask("no tasks", 0)).toBeNull();
  });

  test("keeps the text of the line byte for byte, so history shows one changed line", () => {
    const body = "intro\r\n  -   [ ]   spaced  **out**  \n- [ ] b";
    const next = toggleTask(body, 0);
    expect(next).toBe("intro\r\n  -   [x]   spaced  **out**  \n- [ ] b");
    expect(diffStats(body, next!)).toEqual({ added: 1, removed: 1 });
  });
});
