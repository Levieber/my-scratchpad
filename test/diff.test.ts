import { describe, expect, test } from "bun:test";

import { CONFLICT_MARKERS, diffLines, diffStats, lines, merge3, unifiedDiff } from "../src/diff";

const sides = (ops: ReturnType<typeof diffLines>) => ({
  a: ops.filter((o) => o.type !== "insert").map((o) => o.line),
  b: ops.filter((o) => o.type !== "delete").map((o) => o.line),
});

// Length of the longest common subsequence, the slow obvious way.
function lcs(a: string[], b: string[]): number {
  const t = Array.from({ length: a.length + 1 }, () =>
    Array.from({ length: b.length + 1 }, () => 0),
  );
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      t[i]![j] =
        a[i - 1] === b[j - 1] ? t[i - 1]![j - 1]! + 1 : Math.max(t[i - 1]![j]!, t[i]![j - 1]!);
  return t[a.length]![b.length]!;
}

describe("diffLines", () => {
  test("reproduces both sides and is minimal (random inputs against a brute-force LCS)", () => {
    let seed = 7;
    const rand = (n: number) => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % n;
    for (let run = 0; run < 300; run++) {
      const a = Array.from({ length: rand(12) }, () => "abcd"[rand(4)]!);
      const b = Array.from({ length: rand(12) }, () => "abcd"[rand(4)]!);
      const ops = diffLines(a, b);
      expect(sides(ops)).toEqual({ a, b });
      expect(ops.filter((o) => o.type === "equal").length).toBe(lcs(a, b));
    }
  });

  test("an append is only insertions", () => {
    expect(diffLines(["a", "b"], ["a", "b", "c"]).map((o) => o.type)).toEqual([
      "equal",
      "equal",
      "insert",
    ]);
  });
});

describe("lines and diffStats", () => {
  test("the empty body has no lines", () => {
    expect(lines("")).toEqual([]);
    expect(lines("a\n")).toEqual(["a", ""]);
  });

  test("counts added and removed lines", () => {
    expect(diffStats("", "a\nb")).toEqual({ added: 2, removed: 0 });
    expect(diffStats("a\nb\nc", "a\nB\nc\nd")).toEqual({ added: 2, removed: 1 });
    expect(diffStats("same", "same")).toEqual({ added: 0, removed: 0 });
  });
});

describe("unifiedDiff", () => {
  test("is empty for equal texts", () => {
    expect(unifiedDiff("a\nb", "a\nb")).toBe("");
  });

  test("shows changes with three lines of context, split into hunks", () => {
    const a = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join("\n");
    const b = a.replace("line 2", "line two").replace("line 11", "line eleven");
    expect(unifiedDiff(a, b, ["rev 1", "rev 2"])).toBe(
      [
        "--- rev 1",
        "+++ rev 2",
        "@@ -1,5 +1,5 @@",
        " line 1",
        "-line 2",
        "+line two",
        " line 3",
        " line 4",
        " line 5",
        "@@ -8,5 +8,5 @@",
        " line 8",
        " line 9",
        " line 10",
        "-line 11",
        "+line eleven",
        " line 12",
        "",
      ].join("\n"),
    );
  });

  test("numbers an empty side by the line before it", () => {
    expect(unifiedDiff("", "new")).toBe("--- before\n+++ after\n@@ -0,0 +1,1 @@\n+new\n");
  });
});

describe("merge3", () => {
  const base = "# Plan\n- one\n- two\n- three";

  test("takes the only side that changed", () => {
    expect(merge3(base, base, "x")).toEqual({ text: "x", conflict: false });
    expect(merge3(base, "x", base)).toEqual({ text: "x", conflict: false });
  });

  test("combines edits to different lines", () => {
    const mine = base.replace("- one", "- one!");
    const theirs = base.replace("- three", "- three?");
    expect(merge3(base, mine, theirs)).toEqual({
      text: "# Plan\n- one!\n- two\n- three?",
      conflict: false,
    });
  });

  test("keeps an identical change once", () => {
    const both = base.replace("- two", "- 2");
    expect(merge3(base, both, both + "\n- four")).toEqual({
      text: "# Plan\n- one\n- 2\n- three\n- four",
      conflict: false,
    });
  });

  test("keeps both sides' appends, theirs first", () => {
    expect(merge3(base, base + "\n- mine", base + "\n- theirs")).toEqual({
      text: base + "\n- theirs\n- mine",
      conflict: false,
    });
  });

  test("an agent's append survives an edit made elsewhere in the note", () => {
    const mine = base.replace("# Plan", "# The plan");
    expect(merge3(base, mine, base + "\n2026-09-29 — done").text).toBe(
      "# The plan\n- one\n- two\n- three\n2026-09-29 — done",
    );
  });

  test("marks edits to the same lines as a conflict, keeping both", () => {
    const result = merge3(base, base.replace("- two", "- mine"), base.replace("- two", "- theirs"));
    expect(result).toEqual({
      text: [
        "# Plan",
        "- one",
        CONFLICT_MARKERS.mine,
        "- mine",
        CONFLICT_MARKERS.split,
        "- theirs",
        CONFLICT_MARKERS.theirs,
        "- three",
      ].join("\n"),
      conflict: true,
    });
  });
});
