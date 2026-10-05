import { describe, expect, test } from "bun:test";

import { fields } from "@test/web/fake-server";

import type { Note } from "@/shared/domain";
import { baseOf, Outbox } from "@/web/lib/outbox";
import { withPending, withSettled } from "@/web/lib/pending";
import type { Outcome } from "@/web/lib/sync";

describe("withPending", () => {
  const listed: Note = {
    ...fields({ title: "Listed", body: "old" }),
    id: "listed-1",
    author: "claude-code",
    created_at: "t0",
    updated_at: "t1",
    progress: { done: 0, total: 0 },
    parent_id: null,
    subpages: 0,
  };

  test("shows pending edits, hides pending deletes, and puts new notes first", () => {
    const outbox = new Outbox(null);
    outbox.save("listed-1", fields({ body: "- [x] new" }), baseOf(listed));
    outbox.save("local-1", fields({ body: "# Local\ntext" }), null);
    const shown = withPending([listed], outbox.all(), true);
    expect(shown.map((n) => [n.id, n.title, n.author])).toEqual([
      ["local-1", "Local", "human"],
      ["listed-1", "- [x] new", "claude-code"],
    ]);
    expect(shown[1]!.progress).toEqual({ done: 1, total: 1 });

    outbox.delete("listed-1");
    expect(withPending([listed], outbox.all(), false)).toEqual([]);
  });
});

describe("withSettled", () => {
  const listed = (id: string, body: string) =>
    ({ id, ...fields({ body }), updated_at: "2026-09-29T12:00:00.000Z" }) as Note;

  test("the server's answer replaces the listed note, in place", () => {
    const a = listed("a", "old");
    const b = listed("b", "other");
    const note = { ...a, body: "new", updated_at: "2026-09-29T12:00:01.000Z" };
    const outcome: Outcome = {
      sent: { op: "save", id: "a", seq: 1, fields: fields({ body: "new" }), base: baseOf(a) },
      note,
      merged: false,
      conflict: false,
    };
    expect(withSettled([b, a], outcome, true)).toEqual([b, note]);
  });

  test("a new note goes on top, only where new notes are shown", () => {
    const note = listed("n", "fresh");
    const outcome: Outcome = {
      sent: { op: "save", id: "n", seq: 1, fields: fields({ body: "fresh" }), base: null },
      note,
      merged: false,
      conflict: false,
    };
    const b = listed("b", "other");
    expect(withSettled([b], outcome, true)).toEqual([note, b]);
    expect(withSettled([b], outcome, false)).toEqual([b]);
  });

  test("a deleted note is gone", () => {
    const outcome: Outcome = {
      sent: { op: "delete", id: "a", seq: 1 },
      note: null,
      merged: false,
      conflict: false,
    };
    expect(
      withSettled([listed("a", "x"), listed("b", "y")], outcome, true).map((n) => n.id),
    ).toEqual(["b"]);
  });
});
