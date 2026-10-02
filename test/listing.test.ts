import { describe, expect, test } from "bun:test";

import type { Note } from "../src/domain";
import { groupNotes, preview, visibleTags } from "../src/web/listing";

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
  ...patch,
});

describe("preview", () => {
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

describe("visibleTags", () => {
  const tags = ["a", "b", "c", "d"].map((tag, i) => ({ tag, count: 10 - i }));

  test("shows the most used tags up to the limit", () => {
    expect(visibleTags(tags, [], 2).map((t) => t.tag)).toEqual(["a", "b"]);
  });

  test("always shows the selected tags", () => {
    expect(visibleTags(tags, ["d", "a"], 2).map((t) => t.tag)).toEqual(["a", "b", "d"]);
  });
});
