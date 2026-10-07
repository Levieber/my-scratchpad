import { describe, expect, test } from "bun:test";

import type { Note } from "@/web/lib/api";
import { pinState, withPin } from "@/web/lib/pins";

describe("pinState", () => {
  const pinned = new Set(["a", "b"]);
  // Eight: the most the home page keeps (MAX_PINS).
  const full = new Set(["a", "b", "c", "d", "e", "f", "g", "h"]);
  const none = new Set<string>();

  test("a pinned note can always be unpinned, even with the pins full", () => {
    expect(pinState("a", full, none)).toMatchObject({ pinned: true, disabled: false });
  });

  test("a note can be pinned while there is room", () => {
    expect(pinState("x", pinned, none)).toMatchObject({ pinned: false, disabled: false });
  });

  test("refused once eight are pinned, or before the server has the note", () => {
    expect(pinState("x", full, none)).toMatchObject({
      disabled: true,
      hint: expect.stringContaining("unpin one first"),
    });
    expect(pinState("x", pinned, new Set(["x"]))).toMatchObject({
      disabled: true,
      hint: expect.stringContaining("synced"),
    });
    expect(pinState(undefined, pinned, none)).toMatchObject({ disabled: true });
  });
});

describe("withPin: the pinned list once a pin or an unpin lands", () => {
  const note = (id: string) => ({ id, title: id }) as Note;
  const ids = (notes: Note[]) => notes.map((n) => n.id);

  test("pinning adds the note at the end, unpinning takes it out", () => {
    expect(ids(withPin([note("a")], note("b"), true))).toEqual(["a", "b"]);
    expect(ids(withPin([note("a"), note("b")], note("a"), false))).toEqual(["b"]);
  });

  test("pinning a note already pinned (a double click, two tabs) lists it once", () => {
    const once = withPin([note("a")], note("b"), true);
    expect(ids(withPin(once, note("b"), true))).toEqual(["a", "b"]);
  });
});
