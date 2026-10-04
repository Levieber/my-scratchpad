import { describe, expect, test } from "bun:test";

import type { HooksInfo } from "@/shared/domain";
import { pickedIds, pickState, scopeLabel, withPick } from "@/web/lib/hooks";

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

describe("withPick", () => {
  test("picks and unpicks for everywhere, leaving other places alone", () => {
    const picked = withPick(info(["a"]), "session-start", "b", true);
    expect([...pickedIds(picked, "session-start")]).toEqual(["a", "b"]);
    expect([...pickedIds(picked, "session-start", "pad")]).toEqual(["only-in-pad"]);
    const unpicked = withPick(picked, "session-start", "a", false);
    expect([...pickedIds(unpicked, "session-start")]).toEqual(["b"]);
  });

  test("a hook with no choice for everywhere yet gets one, from its default", () => {
    const bare: HooksInfo = {
      max_include: 3,
      hooks: [
        {
          name: "review",
          description: "",
          default: { query: "kind:reference", limit: 5 },
          max_limit: 30,
          selections: [],
        },
      ],
    };
    const picked = withPick(bare, "review", "x", true);
    expect(picked.hooks[0]?.selections[0]).toMatchObject({
      scope: "",
      query: "kind:reference",
      limit: 5,
      include: ["x"],
    });
  });
});
