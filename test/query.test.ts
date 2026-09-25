import { describe, expect, test } from "bun:test";

import { hasToken, parseQuery, toggleToken } from "../src/query";

describe("parseQuery", () => {
  test("splits kind and tag operators from the search words", () => {
    expect(parseQuery("kind:reference #Launch seo  #checklist tips")).toEqual({
      text: "seo tips",
      kind: "reference",
      tags: ["launch", "checklist"],
    });
  });

  test("plain words only", () => {
    expect(parseQuery("  rotate keys ")).toEqual({ text: "rotate keys", tags: [] });
  });

  test("ignores operators that are still being typed", () => {
    expect(parseQuery("# kind: seo")).toEqual({ text: "seo", tags: [] });
  });

  test("the last kind wins and is lowercased", () => {
    expect(parseQuery("KIND:note kind:Reference").kind).toBe("reference");
  });
});

describe("toggleToken", () => {
  test("adds a token that is missing, keeping the rest", () => {
    expect(toggleToken("seo", "#web")).toBe("seo #web");
    expect(toggleToken("", "#web")).toBe("#web");
  });

  test("removes a token that is present, ignoring case", () => {
    expect(toggleToken("#Web seo #a11y", "#web")).toBe("seo #a11y");
  });

  test("hasToken matches whole tokens only", () => {
    expect(hasToken("#webdev", "#web")).toBe(false);
    expect(hasToken("x #WEB", "#web")).toBe(true);
  });
});
