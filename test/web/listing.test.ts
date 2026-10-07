import { describe, expect, test } from "bun:test";

import type { Note } from "@/shared/domain";
import {
  cardBody,
  groupNotes,
  matchTags,
  preview,
  tableValue,
  toggled,
  visibleFirst,
} from "@/web/lib/listing";

const note = (patch: Partial<Note>): Note => ({
  id: "x",
  title: "Title",
  body: "",
  tags: [],
  kind: "note",
  author: "human",
  created_at: "2026-09-25T12:00:00.000Z",
  updated_at: "2026-09-25T12:00:00.000Z",
  progress: { done: 0, total: 0 },
  parent_id: null,
  subpages: 0,
  ...patch,
});

describe("preview", () => {
  test("leaves out what an embedded view's block says to show", () => {
    const n = note({
      title: "Plan",
      body: "Open work:\n```pad-view\nquery: #todo\n```\nThen ship.",
    });
    expect(preview(n)).toBe("Open work: · Then ship.");
  });

  test("skips a first line that repeats the title", () => {
    const n = note({ title: "SEO checklist", body: "SEO checklist\n\nA generic checklist." });
    expect(preview(n)).toBe("A generic checklist.");
  });

  test("skips a heading that repeats the title, ignoring case", () => {
    const n = note({ title: "SEO checklist", body: "# seo Checklist\nBody" });
    expect(preview(n)).toBe("Body");
  });

  test("keeps a first line that differs from the title", () => {
    const n = note({ title: "Tasks", body: "- [ ] First\n- [x] Second" });
    expect(preview(n)).toBe("First · Second");
  });

  test("strips markdown syntax", () => {
    const n = note({
      body: "## Day one\n- [ ] **`robots.txt`** allows [crawling](https://x.dev)\n1. _one_\n> quote\n```ts\ncode\n```",
    });
    expect(preview(n)).toBe("Day one · robots.txt allows crawling · one · quote · code");
  });

  test("is cut to the given length with an ellipsis", () => {
    const n = note({ body: "a".repeat(50) });
    expect(preview(n, 10)).toBe("aaaaaaaaa…");
  });
});

describe("groupNotes", () => {
  // Local noon, so the day boundaries don't depend on the machine's time zone.
  const now = new Date(2026, 8, 25, 12);
  const daysAgo = (d: number) => new Date(2026, 8, 25 - d, 9).toISOString();

  test("groups into Today, Previous 7 days and Earlier, dropping empty groups", () => {
    const groups = groupNotes(
      [
        note({ id: "t", updated_at: daysAgo(0) }),
        note({ id: "w", updated_at: daysAgo(6) }),
        note({ id: "e", updated_at: daysAgo(7) }),
      ],
      now,
    );
    expect(groups.map((g) => [g.label, g.notes.map((n) => n.id)])).toEqual([
      ["Today", ["t"]],
      ["Previous 7 days", ["w"]],
      ["Earlier", ["e"]],
    ]);
  });

  test("keeps the API's order inside a group", () => {
    const groups = groupNotes(
      [note({ id: "a", updated_at: daysAgo(0) }), note({ id: "b", updated_at: daysAgo(0) })],
      now,
    );
    expect(groups).toEqual([
      {
        label: "Today",
        notes: [expect.objectContaining({ id: "a" }), expect.objectContaining({ id: "b" })],
      },
    ]);
  });
});

describe("visibleFirst", () => {
  const tags = ["a", "b", "c", "d"].map((tag, i) => ({ tag, count: 10 - i }));
  const among = (chosen: string[]) => (t: { tag: string }) => chosen.includes(t.tag);

  test("shows the first items up to the limit", () => {
    expect(visibleFirst(tags, 2, among([])).map((t) => t.tag)).toEqual(["a", "b"]);
  });

  test("always shows the selected ones, in their order", () => {
    expect(visibleFirst(tags, 2, among(["d", "a"])).map((t) => t.tag)).toEqual(["a", "b", "d"]);
  });
});

describe("matchTags", () => {
  // The API's order: most used first.
  const tags = ["todo", "photography", "go", "cargo", "Golang"].map((tag, i) => ({
    tag,
    count: 10 - i,
  }));
  const names = (text: string) => matchTags(tags, text).map((t) => t.tag);

  test("all of them for no text", () => {
    expect(names("  ")).toEqual(["todo", "photography", "go", "cargo", "Golang"]);
  });

  test("those holding the text, whatever its case, starting with it first", () => {
    expect(names("GO")).toEqual(["go", "Golang", "cargo"]);
  });

  test("a leading # is the tag's mark, not part of the text", () => {
    expect(names("#to")).toEqual(["todo", "photography"]);
  });

  test("none when nothing holds it", () => {
    expect(names("zzz")).toEqual([]);
  });
});

describe("toggled", () => {
  test("the one value pressed or released", () => {
    expect(toggled(["a"], ["a", "b"])).toBe("b");
    expect(toggled(["a", "b"], ["a"])).toBe("b");
    expect(toggled(["a"], ["a"])).toBeUndefined();
  });
});

describe("cardBody", () => {
  test("drops a first line repeating the title, and keeps the rest as markdown", () => {
    const n = note({ title: "Plan", body: "\n# Plan\n\n- [ ] **one**\n- [x] two" });
    expect(cardBody(n)).toBe("- [ ] **one**\n- [x] two");
  });

  test("stops at `lines` lines, but never inside a code fence", () => {
    const n = note({ title: "T", body: "a\nb\n```ts\nconst x = 1;\nmore\n```" });
    expect(cardBody(n, 4)).toBe("a\nb");
    expect(cardBody(n, 6)).toBe("a\nb\n```ts\nconst x = 1;\nmore\n```");
  });

  test("a shorter fence inside a longer one is text, as the renderer reads it", () => {
    const n = note({ title: "T", body: "a\n````md\n```\nexample\n```\n````\nb" });
    expect(cardBody(n, 5)).toBe("a");
    expect(cardBody(n, 7)).toBe(n.body);
  });

  test("an empty body has nothing to show", () => {
    expect(cardBody(note({ title: "T", body: "\n\n" }))).toBe("");
  });
});

describe("tableValue", () => {
  test("sorts progress by the share done, with no tasks below none done", () => {
    const value = (done: number, total: number) =>
      tableValue(note({ progress: { done, total } }), "progress");
    expect([value(0, 0), value(0, 2), value(1, 2), value(3, 3)]).toEqual([-1, 0, 0.5, 1]);
  });

  test("titles ignore case; tags read as one string; updated is its time", () => {
    const n = note({ title: "Zebra", tags: ["b", "a"], updated_at: "2026-01-02T00:00:00.000Z" });
    expect(tableValue(n, "title")).toBe("zebra");
    expect(tableValue(n, "tags")).toBe("b a");
    expect(tableValue(n, "updated")).toBe("2026-01-02T00:00:00.000Z");
  });
});
