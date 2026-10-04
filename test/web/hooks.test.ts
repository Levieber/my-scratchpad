import { describe, expect, test } from "bun:test";

import type { HooksInfo } from "@/shared/domain";
import { pickState, scopeLabel } from "@/web/lib/hooks";

const info = (include: string[], max_include = 3): HooksInfo => ({
  max_include,
  hooks: [
    {
      name: "session-start",
      description: "",
      default: { query: "kind:note", limit: 8 },
      max_limit: 30,
      selections: [
        {
          hook: "session-start",
          scope: "",
          query: "kind:note",
          include,
          limit: 8,
          updated_at: "",
          updated_by: "human",
        },
        {
          hook: "session-start",
          scope: "pad",
          query: null,
          include: ["only-in-pad"],
          limit: 8,
          updated_at: "",
          updated_by: "human",
        },
      ],
    },
  ],
});
const none = new Set<string>();

describe("pickState", () => {
  test("a picked note can always be unpicked, even with the list full", () => {
    expect(pickState("a", "session-start", info(["a", "b", "c"]), none)).toMatchObject({
      picked: true,
      disabled: false,
    });
  });

  test("the list menu picks for everywhere: a note picked for one repository isn't picked there", () => {
    expect(pickState("only-in-pad", "session-start", info([]), none).picked).toBe(false);
  });

  test("refused once the list is full, or before the server has the note", () => {
    expect(pickState("x", "session-start", info(["a", "b", "c"]), none)).toMatchObject({
      disabled: true,
      hint: expect.stringContaining("Settings"),
    });
    expect(pickState("x", "session-start", info([]), new Set(["x"]))).toMatchObject({
      disabled: true,
      hint: expect.stringContaining("synced"),
    });
  });

  test("a hook with nothing chosen yet picks freely", () => {
    expect(pickState("x", "review", info([]), none)).toMatchObject({
      picked: false,
      disabled: false,
    });
  });
});

describe("scopeLabel", () => {
  test("names where a choice applies, for people", () => {
    expect(scopeLabel("")).toBe("Everywhere");
    expect(scopeLabel("my-scratchpad")).toBe("my-scratchpad");
    expect(scopeLabel("/home/me/notes")).toBe("Folder /home/me/notes");
  });
});
