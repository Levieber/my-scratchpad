import { describe, expect, test } from "bun:test";

import { EMBED_LIMITS, embedVersion, readEmbed } from "@/shared/embeds";

describe("readEmbed", () => {
  test("reads a search or a saved view, with a layout and a limit", () => {
    expect(readEmbed("query: #todo kind:note\nlayout: grid\nlimit: 5")).toEqual({
      query: "#todo kind:note",
      layout: "grid",
      limit: 5,
    });
    expect(readEmbed("  View :  Weekly review  ")).toEqual({
      view: "Weekly review",
      limit: EMBED_LIMITS.default,
    });
  });

  test("keys it doesn't know are left out; a limit is a positive whole number, capped", () => {
    expect(readEmbed("query: x\ncolumns: 3\nlimit: 0")).toEqual({ query: "x", limit: 10 });
    expect(readEmbed("query: x\nlimit: 500")?.limit).toBe(EMBED_LIMITS.most);
  });

  test("nothing to show, or a version it doesn't know, is no embed", () => {
    expect(readEmbed("layout: grid")).toBeNull();
    expect(readEmbed("query: x", "v2")).toBeNull();
    expect(readEmbed("query: x", "beta")).toBeNull();
    expect(readEmbed("query: x", "v1")).toEqual({ query: "x", limit: 10 });
  });

  test("the version is on the fence: none is 1", () => {
    expect([embedVersion(undefined), embedVersion(" "), embedVersion("v3")]).toEqual([1, 1, 3]);
    expect(embedVersion("3")).toBeNaN();
  });
});
