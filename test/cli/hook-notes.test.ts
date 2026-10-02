import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ROOT, type TestServer, testServer } from "@test/support";
import * as Effect from "effect/Effect";

import { Store } from "@/server/storage/store";

describe("choosing the notes the hooks use", () => {
  let server: TestServer | undefined;
  let config = "";
  afterEach(async () => {
    await server?.stop();
    rmSync(config, { recursive: true, force: true });
  });

  const hooksFile = () => join(config, "scratchpad", "hooks.json");

  async function run(args: string[], stdin = "{}") {
    const proc = Bun.spawn(["bun", join(ROOT, "src/cli.ts"), ...args], {
      stdin: new Blob([stdin]),
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        PAD_URL: server!.url.origin,
        PAD_TOKEN: "",
        // Keeps the real ~/.config (and its token) out of the test.
        XDG_CONFIG_HOME: config,
        XDG_CACHE_HOME: config,
      },
    });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    return out.trim();
  }

  const pad = (...args: string[]) => run(args);
  // A hook the way Claude Code runs it: the event as JSON on stdin.
  const hook = (name: string, event: object) => run(["hook", name], JSON.stringify(event));

  const choose = (chosen: object) => {
    mkdirSync(join(config, "scratchpad"), { recursive: true });
    writeFileSync(hooksFile(), JSON.stringify(chosen));
  };

  async function boot() {
    server = await testServer();
    await server.run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* store.create({ title: "Groceries", body: "milk" });
        yield* store.create({ title: "Pinned plan", body: "ship it", tags: ["pinned"] });
        yield* store.create({
          title: "SEO checklist",
          body: "x",
          kind: "reference",
          tags: ["seo"],
        });
        yield* store.create({ title: "Code style", body: "y", kind: "reference", tags: ["code"] });
      }),
    );
    config = mkdtempSync(join(tmpdir(), "pad-hook-notes-"));
  }

  const sessionContext = async () =>
    JSON.parse(await hook("session-start", {})).hookSpecificOutput.additionalContext as string;

  test("by default the session lists notes, not references, and the review lists references", async () => {
    await boot();
    const context = await sessionContext();
    expect(context).toContain("## Recent notes");
    expect(context).toContain("Groceries");
    expect(context).not.toContain("SEO checklist");
    expect(context).toContain("aren't loaded here");
  });

  test("a chosen query decides which notes the session lists", async () => {
    await boot();
    choose({ "session-start": "#pinned" });
    const context = await sessionContext();
    expect(context).toContain("Notes selected by the user (#pinned)");
    expect(context).toContain("Pinned plan");
    expect(context).not.toContain("Groceries");
    // The choice may include references, so the context no longer says they are left out.
    expect(context).not.toContain("aren't loaded here");
  });

  test("a chosen query decides which references the review offers", async () => {
    await boot();
    choose({ review: "kind:reference #seo" });
    await hook("record-edit", { session_id: "s", tool_input: { file_path: join(ROOT, "a.ts") } });
    const reason = JSON.parse(await hook("review", { session_id: "s", cwd: ROOT }))
      .reason as string;
    expect(reason).toContain("SEO checklist");
    expect(reason).not.toContain("Code style");
  });

  test("pad hooks set saves a choice, shows what it selects, and reset undoes it", async () => {
    await boot();
    expect(await pad("hooks")).toBe(
      "session-start  kind:note  (default)\nreview         kind:reference  (default)",
    );

    const set = await pad("hooks", "set", "session-start", "#pinned");
    expect(set).toContain("session-start: #pinned");
    expect(set).toContain("Pinned plan");
    expect(set).not.toContain("Groceries");
    expect(JSON.parse(readFileSync(hooksFile(), "utf8"))).toEqual({ "session-start": "#pinned" });
    expect(await pad("hooks")).toContain("session-start  #pinned\n");

    // One hook's reset leaves the other's choice alone.
    await pad("hooks", "set", "review", "kind:reference", "#seo");
    await pad("hooks", "reset", "session-start");
    expect(JSON.parse(readFileSync(hooksFile(), "utf8"))).toEqual({
      review: "kind:reference #seo",
    });
    await pad("hooks", "reset");
    expect(JSON.parse(readFileSync(hooksFile(), "utf8"))).toEqual({});
  });

  test("a choice that matches nothing says so", async () => {
    await boot();
    expect(await pad("hooks", "set", "review", "#nothing")).toContain("no notes match");
  });

  test("logging out keeps the choices", async () => {
    await boot();
    await pad("hooks", "set", "review", "#seo");
    await pad("logout");
    expect(existsSync(hooksFile())).toBe(true);
  });
});
