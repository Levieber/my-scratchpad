import { describe, expect, test } from "bun:test";

import {
  bySpecificity,
  HOOK_NAMES,
  hereScope,
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

  test("a folder in the home directory is written from ~, keeping its case", () => {
    expect(normalizeScope(" ~/Work/ ")).toBe("~/Work");
    expect(normalizeScope("~//work//clients")).toBe("~/work/clients");
  });

  test("refuses scopes that climb or that would mean every folder", () => {
    expect(normalizeScope("my-scratchpad/../other")).toBeUndefined();
    expect(normalizeScope("./my-scratchpad")).toBeUndefined();
    expect(normalizeScope("/")).toBeUndefined();
    expect(normalizeScope("~")).toBeUndefined();
    expect(normalizeScope("~/../etc")).toBeUndefined();
    // Another user's home isn't something a hook knows.
    expect(normalizeScope("~bob/work")).toBeUndefined();
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

  test("a folder from ~ matches in each machine's home, wherever that is", () => {
    expect(scopeMatches("~/work", { home: "/home/me", dir: "/home/me/work/app/src" })).toBe(true);
    expect(scopeMatches("~/work", { home: "/Users/me", dir: "/Users/me/work" })).toBe(true);
    expect(scopeMatches("~/work", { home: "/home/me", dir: "/home/me/workshop" })).toBe(false);
    // A client that doesn't say where its home is can't be in it.
    expect(scopeMatches("~/work", { dir: "/home/me/work" })).toBe(false);
  });
});

describe("bySpecificity", () => {
  const inWork = { repo: "my-app", path: "src", dir: "/home/me/work/my-app/src" };

  test("the place closest to where the agent works comes first, everywhere last", () => {
    const scopes = ["", "my-app", "/home/me/work/my-app/src/deep", "my-app/src"];
    expect(scopes.toSorted(bySpecificity(inWork))).toEqual([
      "/home/me/work/my-app/src/deep",
      "my-app/src",
      "my-app",
      "",
    ]);
  });

  test("a folder holding many projects is broader than any repository inside it", () => {
    expect(["/home/me/work", "my-app"].toSorted(bySpecificity(inWork))).toEqual([
      "my-app",
      "/home/me/work",
    ]);
    expect(["~/work", "my-app"].toSorted(bySpecificity({ ...inWork, home: "/home/me" }))).toEqual([
      "my-app",
      "~/work",
    ]);
    // A folder inside the repository is narrower than the repository.
    expect(["my-app", "/home/me/work/my-app/src"].toSorted(bySpecificity(inWork))).toEqual([
      "/home/me/work/my-app/src",
      "my-app",
    ]);
  });
});

describe("scopeLocation", () => {
  test("is a place the scope applies to, so a selection can be previewed from anywhere", () => {
    for (const scope of ["", "my-scratchpad", "my-scratchpad/apps/web", "/home/me/notes", "~/work"])
      expect(scopeMatches(scope, scopeLocation(scope))).toBe(true);
    expect(scopeLocation("my-scratchpad/apps/web")).toEqual({
      repo: "my-scratchpad",
      path: "apps/web",
    });
    expect(scopeLocation("/home/me/notes")).toEqual({ dir: "/home/me/notes" });
    expect(scopeLocation("")).toEqual({});
  });
});

describe("hereScope", () => {
  test("names the repository, else the folder from ~ when it's in the home directory", () => {
    expect(hereScope({ repo: "my-app", path: "src", dir: "/home/me/work/my-app/src" })).toBe(
      "my-app",
    );
    expect(hereScope({ dir: "/home/me/work/notes", home: "/home/me" })).toBe("~/work/notes");
    expect(hereScope({ dir: "/srv/notes", home: "/home/me" })).toBe("/srv/notes");
    // The home directory itself would mean nearly everywhere: named in full instead.
    expect(hereScope({ dir: "/home/me", home: "/home/me" })).toBe("/home/me");
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
