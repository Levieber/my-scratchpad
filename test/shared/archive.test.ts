import { describe, expect, test } from "bun:test";

import { ARCHIVE_FORMAT, ARCHIVE_VERSION, parseArchive } from "@/shared/archive";

const at = "2026-09-29T10:00:00.000Z";
const note = (over: Record<string, unknown> = {}) => ({
  id: "note-0001",
  title: "Rules",
  body: "- [ ] one",
  tags: ["x"],
  kind: "reference" as const,
  author: "claude-code",
  created_at: at,
  updated_at: at,
  ...over,
});
const archive = (over: Record<string, unknown> = {}) => ({
  format: ARCHIVE_FORMAT,
  version: ARCHIVE_VERSION,
  exported_at: at,
  notes: [note()],
  ...over,
});

const ok = (data: unknown) => {
  const parsed = parseArchive(data);
  if (!parsed.ok) throw new Error(`expected an archive, got ${parsed.code}: ${parsed.message}`);
  return parsed.archive;
};
const refused = (data: unknown) => {
  const parsed = parseArchive(data);
  if (parsed.ok) throw new Error("expected a refusal");
  return parsed;
};

describe("parseArchive", () => {
  test("reads a bare array of notes as version 1, the file `pad export` used to write", () => {
    const parsed = ok([{ ...note(), progress: { done: 0, total: 1 } }]);
    expect(parsed.version).toBe(1);
    expect(parsed.notes).toEqual([note()]);
    expect([parsed.views, parsed.pins, parsed.hook_selections]).toEqual([[], [], []]);
  });

  test("reads a version 2 archive with history, views, pins and hook selections", () => {
    const revision = {
      title: "Rules",
      body: "- [ ] one",
      tags: ["x"],
      kind: "reference" as const,
      author: "claude-code",
      updated_at: at,
      added: 1,
      removed: 0,
    };
    const view = { id: "view-0001", name: "Open", query: "#todo", created_at: at };
    const pin = { note_id: "note-0001", pinned_at: at };
    const selection = {
      hook: "review",
      scope: "",
      query: "kind:reference",
      include: ["note-0001"],
      limit: 100,
      updated_at: at,
      updated_by: "human",
    };
    const parsed = ok(
      archive({
        notes: [note({ revisions: [revision] })],
        views: [view],
        pins: [pin],
        hook_selections: [selection],
      }),
    );
    expect(parsed.version).toBe(2);
    expect(parsed.notes[0]?.revisions).toEqual([revision]);
    expect(parsed.views).toEqual([view]);
    expect(parsed.pins).toEqual([pin]);
    expect(parsed.hook_selections).toEqual([selection]);
    expect(parsed.rejected).toEqual([]);
  });

  test("a version newer than this one is refused, naming the newest it reads", () => {
    const parsed = refused(archive({ version: ARCHIVE_VERSION + 1 }));
    expect(parsed.code).toBe("unsupportedFormat");
    expect(parsed.message).toContain(`version ${ARCHIVE_VERSION + 1}`);
    expect(parsed.message).toContain(`up to version ${ARCHIVE_VERSION}`);
  });

  test.each([
    ["not an archive or an array", "text"],
    ["another format", archive({ format: "something-else" })],
    ["no version", archive({ version: undefined })],
    ["a version that is not a whole number", archive({ version: "2" })],
    ["notes that are not a list", archive({ notes: {} })],
  ])("refuses %s as invalid", (_, data) => {
    expect(refused(data).code).toBe("invalidImport");
  });

  test("fields it does not know are left out instead of failing, at the top and in a note", () => {
    const parsed = ok(archive({ added_later: true, notes: [note({ colour: "red" })] }));
    expect(parsed.notes).toEqual([note()]);
    expect(parsed.notes[0]).not.toHaveProperty("colour");
  });

  test("a bad note is rejected by position and the rest still read", () => {
    const parsed = ok([
      note(),
      { ...note(), id: "no" },
      { ...note({ id: "note-0003" }), kind: "diary" },
      { ...note({ id: "note-0004" }), updated_at: "yesterday" },
      note({ id: "note-0005", title: "", body: "" }),
      "text",
      note({ id: "note-0007" }),
    ]);
    expect(parsed.notes.map((n) => n.id)).toEqual(["note-0001", "note-0007"]);
    expect(parsed.rejected.map((r) => r.item)).toEqual([
      "note 2",
      "note 3",
      "note 4",
      "note 5",
      "note 6",
    ]);
    expect(parsed.rejected[0]?.message).toContain("id must be 8-64");
    expect(parsed.rejected[1]?.message).toContain("kind");
    expect(parsed.rejected[3]?.message).toContain("body or a title");
  });

  test("a note needs only a body or a title; the rest is filled in by whoever imports it", () => {
    expect(ok([{ body: "hello" }]).notes).toEqual([{ body: "hello" }]);
  });

  test("a bad revision rejects its note alone, and a bad view or pin alone", () => {
    const parsed = ok(
      archive({
        notes: [note({ revisions: [{ title: 1 }] }), note({ id: "note-0002" })],
        views: [
          { name: "", query: "x" },
          { name: "Ok", query: "#a" },
        ],
        pins: [{ note_id: 3 }, { note_id: "note-0002" }],
      }),
    );
    expect(parsed.notes.map((n) => n.id)).toEqual(["note-0002"]);
    expect(parsed.views.map((v) => v.name)).toEqual(["Ok"]);
    expect(parsed.pins.map((p) => p.note_id)).toEqual(["note-0002"]);
    expect(parsed.rejected.map((r) => r.item)).toEqual(["note 1", "view 1", "pin 1"]);
  });
});
