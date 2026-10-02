import { describe, expect, test } from "bun:test";

import { pinState } from "@/web/lib/pins";

describe("pinState", () => {
  const pinned = new Set(["a", "b"]);
  const full = new Set(["a", "b", "c"]);
  const none = new Set<string>();

  test("a pinned note can always be unpinned, even with the pins full", () => {
    expect(pinState("a", full, none)).toMatchObject({ pinned: true, disabled: false });
  });

  test("a note can be pinned while there is room", () => {
    expect(pinState("x", pinned, none)).toMatchObject({ pinned: false, disabled: false });
  });

  test("refused once three are pinned, or before the server has the note", () => {
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
