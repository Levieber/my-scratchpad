import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { locate } from "@/client/location";

const base = realpathSync(mkdtempSync(join(tmpdir(), "pad-location-")));
afterAll(() => rmSync(base, { recursive: true, force: true }));

const git = (cwd: string, ...args: string[]) => {
  const run = Bun.spawnSync(["git", "-C", cwd, ...args]);
  if (!run.success) throw new Error(run.stderr.toString());
};

describe("locate", () => {
  test("inside a repository: its remote's name and the folder within it", () => {
    const repo = join(base, "checkout-folder");
    mkdirSync(join(repo, "apps", "web"), { recursive: true });
    git(repo, "init", "-q");
    git(repo, "remote", "add", "origin", "git@github.com:me/My-App.git");
    expect(locate(join(repo, "apps", "web"), "/home/me")).toEqual({
      repo: "my-app",
      path: "apps/web",
      dir: join(repo, "apps", "web"),
      home: "/home/me",
    });
    expect(locate(repo, "/home/me")).toEqual({
      repo: "my-app",
      path: "",
      dir: repo,
      home: "/home/me",
    });
  });

  test("a repository without a remote is named by its folder", () => {
    const repo = join(base, "Scratch");
    mkdirSync(repo);
    git(repo, "init", "-q");
    expect(locate(repo)).toMatchObject({ repo: "scratch", path: "" });
  });

  test("outside any repository, only the folder and the home directory", () => {
    const plain = join(base, "plain");
    mkdirSync(plain);
    expect(locate(plain, "/home/me")).toEqual({ dir: plain, home: "/home/me" });
  });
});
