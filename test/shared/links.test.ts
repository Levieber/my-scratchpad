import { describe, expect, test } from "bun:test";

import { namesNote, noteLinks } from "@/shared/links";

describe("noteLinks", () => {
  test("reads a title, an id, and a link with its own text", () => {
    expect(noteLinks("See [[Launch plan]], [[abc12345]] and [[Spec|the spec]].")).toEqual([
      { target: "Launch plan", text: "Launch plan" },
      { target: "abc12345", text: "abc12345" },
      { target: "Spec", text: "the spec" },
    ]);
  });

  test("leaves out what is code, and what isn't a whole link", () => {
    const body = [
      "`[[inline example]]` and [[real]]",
      "```md",
      "[[fenced example]]",
      "```",
      "[[ ]] [single] [[unclosed",
      "[[across",
      "lines]]",
    ].join("\n");
    expect(noteLinks(body).map((l) => l.target)).toEqual(["real"]);
  });
});

describe("namesNote", () => {
  test("by id, or by title ignoring case and spaces around it", () => {
    const note = { id: "abc12345", title: "Launch Plan" };
    expect(["abc12345", " launch plan ", "LAUNCH PLAN"].map((t) => namesNote(t, note))).toEqual([
      true,
      true,
      true,
    ]);
    expect(namesNote("Launch", note)).toBe(false);
  });
});
