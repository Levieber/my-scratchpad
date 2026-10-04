import { describe, expect, test } from "bun:test";

import {
  bySpecificity,
  HOOK_NAMES,
  HOOKS,
  isHookName,
  normalizeScope,
  repoName,
  scopeLocation,
  scopeMatches,
} from "@/shared/hooks";

describe("the hooks that read notes", () => {
  test("session start lists recent notes and the review lists references, by default", () => {
    expect(HOOK_NAMES).toEqual(["session-start", "review"]);
    expect(HOOKS["session-start"]).toMatchObject({ query: "kind:note", limit: 8 });
    expect(HOOKS.review).toMatchObject({ query: "kind:reference", limit: 100 });
  });

  test("a name that isn't a hook is refused", () => {
    expect(isHookName("review")).toBe(true);
    expect(isHookName("toString")).toBe(false);
    expect(isHookName("pre-compact")).toBe(false);
  });
});

describe("normalizeScope", () => {
  test("empty means everywhere", () => {
    expect(normalizeScope("")).toBe("");
    expect(normalizeScope("   ")).toBe("");
  });

  test("a repo name is lowercased, and its folder loses stray slashes", () => {
    expect(normalizeScope(" My-Scratchpad/ ")).toBe("my-scratchpad");
    expect(normalizeScope("my-scratchpad//apps/web/")).toBe("my-scratchpad/apps/web");
  });

  test("an absolute folder keeps its case", () => {
    expect(normalizeScope("/home/Me/notes/")).toBe("/home/Me/notes");
  });

  test("refuses scopes that climb or that would mean every folder", () => {
    expect(normalizeScope("my-scratchpad/../other")).toBeUndefined();
    expect(normalizeScope("./my-scratchpad")).toBeUndefined();
    expect(normalizeScope("/")).toBeUndefined();
  });
});

describe("scopeMatches", () => {
  const inWeb = { repo: "my-scratchpad", path: "apps/web", dir: "/src/my-scratchpad/apps/web" };

  test("everywhere matches any location, even one outside a repo", () => {
    expect(scopeMatches("", inWeb)).toBe(true);
    expect(scopeMatches("", {})).toBe(true);
  });

  test("a repo matches every folder inside it, and no other repo", () => {
    expect(scopeMatches("my-scratchpad", inWeb)).toBe(true);
    expect(scopeMatches("my-scratchpad", { repo: "my-scratchpad", path: "" })).toBe(true);
    expect(scopeMatches("upbet", inWeb)).toBe(false);
    expect(scopeMatches("my-scratchpad", { dir: "/src/my-scratchpad" })).toBe(false);
  });

  test("a folder inside a repo matches itself and below, not a sibling sharing its prefix", () => {
    expect(scopeMatches("my-scratchpad/apps/web", inWeb)).toBe(true);
    expect(scopeMatches("my-scratchpad/apps", inWeb)).toBe(true);
    expect(scopeMatches("my-scratchpad/apps/we", inWeb)).toBe(false);
    expect(scopeMatches("my-scratchpad/apps/web", { ...inWeb, path: "apps" })).toBe(false);
  });

  test("an absolute folder matches by directory, inside a repo or not", () => {
    expect(scopeMatches("/src/my-scratchpad", inWeb)).toBe(true);
    expect(scopeMatches("/src/my", inWeb)).toBe(false);
    expect(scopeMatches("/home/me/notes", { dir: "/home/me/notes/2026" })).toBe(true);
    expect(scopeMatches("/home/me/notes", {})).toBe(false);
  });
});

describe("bySpecificity", () => {
  test("the most specific scope comes first and everywhere comes last", () => {
    const scopes = ["", "my-scratchpad", "/src/my-scratchpad/apps/web", "my-scratchpad/apps"];
    expect(scopes.toSorted(bySpecificity)).toEqual([
      "/src/my-scratchpad/apps/web",
      "my-scratchpad/apps",
      "my-scratchpad",
      "",
    ]);
  });
});

describe("scopeLocation", () => {
  test("is a place the scope applies to, so a selection can be previewed from anywhere", () => {
    for (const scope of ["", "my-scratchpad", "my-scratchpad/apps/web", "/home/me/notes"])
      expect(scopeMatches(scope, scopeLocation(scope))).toBe(true);
    expect(scopeLocation("my-scratchpad/apps/web")).toEqual({
      repo: "my-scratchpad",
      path: "apps/web",
    });
    expect(scopeLocation("/home/me/notes")).toEqual({ dir: "/home/me/notes" });
    expect(scopeLocation("")).toEqual({});
  });
});

describe("repoName", () => {
  test("takes the last part of the remote, whatever its form", () => {
    expect(repoName("git@github.com:Levieber/my-scratchpad.git", "/x/hook-notes")).toBe(
      "my-scratchpad",
    );
    expect(repoName("https://github.com/Levieber/My-Scratchpad", "/x/y")).toBe("my-scratchpad");
    expect(repoName("ssh://git@host:2222/team/app.git/", "/x/y")).toBe("app");
    expect(repoName("/srv/git/notes.git", "/x/y")).toBe("notes");
  });

  test("without a remote, the repository's folder names it", () => {
    expect(repoName(undefined, "/home/me/Projects/Pad")).toBe("pad");
    expect(repoName("", "/home/me/pad")).toBe("pad");
  });
});
