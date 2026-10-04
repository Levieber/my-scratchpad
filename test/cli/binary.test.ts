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
    } finally {
      proc.kill("SIGINT");
      await proc.exited;
    }
  });
});
