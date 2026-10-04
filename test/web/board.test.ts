import { describe, expect, test } from "bun:test";

import type { Note } from "@/shared/domain";
import type { GroupBy } from "@/shared/layouts";
import { columnsOf, DEFAULT_GROUP_BY, movable, movedTags, readGroupBy } from "@/web/lib/board";

const note = (id: string, tags: string[], progress = { done: 0, total: 0 }): Note => ({
  id,
  title: id,
  body: "",
  tags,
  kind: "note",
  author: "human",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  progress,
});

const shape = (g: GroupBy, notes: Note[]) =>
  columnsOf(notes, g).map((c) => [c.label, c.notes.map((n) => n.id)]);

describe("columnsOf", () => {
  test("by prefix: declared columns first, even empty, then values in use, then none", () => {
    const notes = [
      note("a", ["status:doing", "work"]),
      note("b", ["status:blocked"]),
      note("c", ["work"]),
      note("d", ["status:todo"]),
    ];
    expect(shape(DEFAULT_GROUP_BY, notes)).toEqual([
      ["todo", ["d"]],
      ["doing", ["a"]],
      ["done", []],
      ["blocked", ["b"]],
      ["No status", ["c"]],
    ]);
  });

  test("a note with two values shows once, in the first column", () => {
    const columns = columnsOf([note("a", ["status:done", "status:todo"])], DEFAULT_GROUP_BY);
    expect(columns.flatMap((c) => c.notes.map((n) => [c.label, n.id]))).toEqual([["todo", "a"]]);
  });

  test("by tags: a column per tag, in the order chosen", () => {
    const g: GroupBy = { by: "tags", tags: ["urgent", "later"] };
    expect(shape(g, [note("a", ["later"]), note("b", ["urgent", "later"]), note("c", [])])).toEqual(
      [
        ["urgent", ["b"]],
        ["later", ["a"]],
        ["None of these", ["c"]],
      ],
    );
  });

  test("by checklist: from progress, and nothing to move", () => {
    const g: GroupBy = { by: "checklist" };
    const notes = [
      note("none", []),
      note("todo", [], { done: 0, total: 2 }),
      note("doing", [], { done: 1, total: 2 }),
      note("done", [], { done: 2, total: 2 }),
    ];
    expect(shape(g, notes)).toEqual([
      ["No tasks", ["none"]],
      ["To do", ["todo"]],
      ["Under way", ["doing"]],
      ["Done", ["done"]],
    ]);
    expect(movable(g)).toBe(false);
  });
});

describe("movedTags", () => {
  test("by prefix: the value changes, every other tag stays", () => {
    const [, doing, , none] = columnsOf([], DEFAULT_GROUP_BY);
    expect(movedTags(["work", "status:todo", "status:x"], DEFAULT_GROUP_BY, doing!)).toEqual([
      "work",
      "status:doing",
    ]);
    expect(movedTags(["status:todo", "work"], DEFAULT_GROUP_BY, none!)).toEqual(["work"]);
  });

  test("by tags: only the chosen tags move", () => {
    const g: GroupBy = { by: "tags", tags: ["urgent", "later"] };
    const [urgent] = columnsOf([], g);
    expect(movedTags(["later", "home"], g, urgent!)).toEqual(["home", "urgent"]);
  });
});

describe("readGroupBy", () => {
  test("reads what it knows, and falls back to the default for anything else", () => {
    expect(readGroupBy({ by: "tags", tags: ["a", 1] })).toEqual({ by: "tags", tags: ["a"] });
    expect(readGroupBy({ by: "checklist", extra: 1 })).toEqual({ by: "checklist" });
    expect(readGroupBy({ by: "prefix", prefix: "" })).toEqual(DEFAULT_GROUP_BY);
    expect(readGroupBy({ by: "assignee" })).toEqual(DEFAULT_GROUP_BY);
    expect(readGroupBy(undefined)).toEqual(DEFAULT_GROUP_BY);
  });
});
