import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ROOT, type TestServer, testServer } from "@test/support";
import * as Effect from "effect/Effect";

import { Store } from "@/server/storage/store";

// `pad` as `bun run setup:claude` installs it: one executable with bytecode. What only breaks once
// compiled (files read from disk, lazy imports, bytecode) breaks here.
const dir = mkdtempSync(join(tmpdir(), "pad-binary-"));
const pad = join(dir, "pad");
let server: TestServer;

beforeAll(async () => {
  const build = Bun.spawnSync(["bun", "run", "build:pad", `--outfile=${pad}`], { cwd: ROOT });
  expect(build.exitCode).toBe(0);
  server = await testServer();
  await server.run(
    Effect.flatMap(Effect.service(Store), (s) => s.create({ title: "Binary note" })),
  );
}, 60_000);

afterAll(async () => {
  await server.stop();
  rmSync(dir, { recursive: true, force: true });
});

// Async: the test server runs in this process, so a sync spawn would block it from answering.
const run = async (args: string[], stdin = "") => {
  const proc = Bun.spawn([pad, ...args], {
    stdin: new Blob([stdin]),
    env: {
      ...process.env,
      PAD_URL: server.url.origin,
      PAD_TOKEN: "",
      XDG_CONFIG_HOME: dir,
      XDG_CACHE_HOME: dir,
    },
    stdout: "pipe",
  });
  const out = (await new Response(proc.stdout).text()).trim();
  return { code: await proc.exited, out };
};

describe("compiled pad", () => {
  test("runs commands against the API", async () => {
    expect((await run(["--version"])).out).toBe("pad v0.1.0");
    const ls = await run(["ls"]);
    expect([ls.code, ls.out]).toEqual([0, expect.stringContaining("Binary note")]);
  });

  test("exports an archive, with or without history, and imports it back without changing anything", async () => {
    const file = join(dir, "export.json");
    const whole = await run(["export", file]);
    const archive = JSON.parse(readFileSync(file, "utf8"));
    expect(archive).toMatchObject({ format: "pad-export", version: 2 });
    expect(whole.out).toBe(`exported ${archive.notes.length} notes to ${file} with their history`);
    expect(archive.notes[0].revisions.length).toBeGreaterThan(0);

    const bare = await run(["export", file, "--no-history"]);
    expect(bare.out).toBe(`exported ${archive.notes.length} notes to ${file}`);
    expect(JSON.parse(readFileSync(file, "utf8")).notes[0]).not.toHaveProperty("revisions");

    const again = await run(["import", file]);
    expect([again.code, again.out]).toEqual([
      0,
      `created 0, skipped ${archive.notes.length} existing`,
    ]);
  });

  test("saves a view with its layout and lists it", async () => {
    const added = await run(["views", "add", "Todo", "#todo", "--layout", "board"]);
    expect([added.code, added.out]).toEqual([0, "saved Todo: #todo  [board]"]);
    expect((await run(["views"])).out).toBe("@Todo  #todo  [board]");
    expect((await run(["views", "add", "Bad", "x", "--layout", "calendar"])).code).not.toBe(0);
  });

  test("files a note under a page, lists what is under it, and moves it to the top", async () => {
    const page = (await run(["add", "Project page"])).out;
    const sub = (await run(["add", "A subpage", "--parent", page])).out;
    expect((await run(["ls", "--parent", page])).out).toContain(`${sub}  A subpage`);
    expect((await run(["ls", "--parent", "none"])).out).toContain(`Project page +1 under`);
    expect((await run(["show", sub])).out).toContain(`under ${page}`);
    await run(["set", sub, "--parent", "none"]);
    expect((await run(["ls", "--parent", page])).out).toBe("(no notes)");
  });

  test("runs the SessionStart hook", async () => {
    const { code, out } = await run(["hook", "session-start"], JSON.stringify({ session_id: "s" }));
    expect(code).toBe(0);
    expect(JSON.parse(out).hookSpecificOutput.additionalContext).toContain("Binary note");
  });

  test("serves the PWA and its root files from inside the executable", async () => {
    const port = "7796";
    const proc = Bun.spawn([pad, "serve"], {
      env: {
        ...process.env,
        PAD_PORT: port,
        PAD_DB: join(dir, "serve.db"),
        PAD_TOKEN: "",
        NODE_ENV: "production",
      },
      stdout: "ignore",
      stderr: "ignore",
    });
    try {
      const base = `http://127.0.0.1:${port}`;
      for (let i = 0; i < 50; i++) {
        if (
          await fetch(`${base}/api/health`).then(
            (r) => r.ok,
            () => false,
          )
        )
          break;
        await Bun.sleep(100);
      }
      const page = await (await fetch(base)).text();
      const script = /src="([^"]+\.js)"/.exec(page)?.[1] ?? "(no script in the page)";
      const statuses = await Promise.all(
        ["/sw.js", "/manifest.webmanifest", "/icon.svg", script].map(async (path) => [
          path,
          (await fetch(new URL(path, base))).status,
        ]),
      );
      expect(statuses).toEqual([
        ["/sw.js", 200],
        ["/manifest.webmanifest", 200],
        ["/icon.svg", 200],
        [script, 200],
      ]);
      // The production build: without it, React's development build and Query's devtools
      // (their `tsqd-` classes) shipped too, half again as much to download and run.
      expect((await (await fetch(new URL(script, base))).text()).includes("tsqd-")).toBe(false);
    } finally {
      proc.kill("SIGINT");
      await proc.exited;
    }
  });
});

const upAt = async (url: string) => {
  for (let i = 0; i < 50; i++) {
    if (
      await fetch(url).then(
        (r) => r.ok,
        () => false,
      )
    )
      return;
    await Bun.sleep(100);
  }
};

// What production runs (scripts/start.sh): each server built into an executable of its own.
describe("the servers as executables", () => {
  const build = (target: string) =>
    Bun.spawnSync(["bun", "scripts/build.ts", target, `--outfile=${join(dir, `pad-${target}`)}`], {
      cwd: ROOT,
    }).exitCode;

  test("the API serves the PWA it carries, its lazy chunks prefetched and served", async () => {
    expect(build("server")).toBe(0);
    const port = "7797";
    const proc = Bun.spawn([join(dir, "pad-server")], {
      env: {
        ...process.env,
        PAD_PORT: port,
        PAD_DB: join(dir, "server.db"),
        PAD_TOKEN: "",
        NODE_ENV: "production",
      },
      stdout: "pipe",
      stderr: "ignore",
    });
    try {
      const base = `http://127.0.0.1:${port}`;
      await upAt(`${base}/api/health`);
      const page = await (await fetch(base)).text();
      const files = [...page.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]!);
      const lazy = files.filter((f) => page.includes(`rel="prefetch" crossorigin href="${f}"`));
      expect(lazy.length).toBeGreaterThanOrEqual(4);
      const statuses = await Promise.all(
        ["/sw.js", ...files].map(async (path) => [path, (await fetch(new URL(path, base))).status]),
      );
      expect(statuses).toEqual(["/sw.js", ...files].map((path) => [path, 200]));
    } finally {
      proc.kill("SIGINT");
      await proc.exited;
    }
    // Built already: nothing to build at start, and nothing bundled on the first request.
    expect(await new Response(proc.stdout).text()).toContain("PWA built into the executable");
  }, 60_000);

  test("the MCP server over HTTP starts and answers its health check", async () => {
    expect(build("mcp")).toBe(0);
    const port = "7798";
    const proc = Bun.spawn([join(dir, "pad-mcp")], {
      env: {
        ...process.env,
        PAD_MCP_PORT: port,
        PORT: "",
        PAD_URL: server.url.origin,
        PAD_TOKEN: "test-token",
        NODE_ENV: "production",
      },
      stdout: "ignore",
      stderr: "ignore",
    });
    try {
      await upAt(`http://127.0.0.1:${port}/health`);
      expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
    } finally {
      proc.kill("SIGINT");
      await proc.exited;
    }
  }, 60_000);
});
