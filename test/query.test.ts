import { describe, expect, test } from "bun:test";

import { hasToken, operatorValue, parseQuery, setOperator, toggleToken } from "@/query";

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

describe("author operator", () => {
  test("parses author next to the other operators", () => {
    expect(parseQuery("Author:Agent #log kind:note seo")).toEqual({
      text: "seo",
      kind: "note",
      author: "agent",
      tags: ["log"],
    });
    expect(parseQuery("author:").author).toBeUndefined();
  });

  test("setOperator replaces the earlier value and clears on empty", () => {
    expect(setOperator("seo author:human", "author", "agent")).toBe("seo author:agent");
    expect(setOperator("seo #web kind:reference", "kind", "")).toBe("seo #web");
    expect(setOperator("", "kind", "reference")).toBe("kind:reference");
  });

  test("operatorValue reads it back, or empty", () => {
    expect(operatorValue("author:Agent", "author")).toBe("agent");
    expect(operatorValue("seo", "kind")).toBe("");
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
