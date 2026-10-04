import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ROOT, type TestServer, testServer } from "@test/support";
import * as Effect from "effect/Effect";

import { Store } from "@/server/storage/store";

describe("choosing the notes the hooks use", () => {
  let server: TestServer | undefined;
  let stub: ReturnType<typeof Bun.serve> | undefined;
  let config = "";
  afterEach(async () => {
    await server?.stop();
    await stub?.stop(true);
    server = undefined;
    stub = undefined;
    rmSync(config, { recursive: true, force: true });
  });

  const hooksFile = () => join(config, "scratchpad", "hooks.json");

  async function run(args: string[], { stdin = "{}", cwd = ROOT } = {}) {
    const proc = Bun.spawn(["bun", join(ROOT, "src/cli.ts"), ...args], {
      cwd,
      stdin: new Blob([stdin]),
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        PAD_URL: (server?.url ?? stub!.url).origin,
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
  const padIn = (cwd: string, ...args: string[]) => run(args, { cwd });
  // A hook the way Claude Code runs it: the event as JSON on stdin.
  const hook = (name: string, event: object) =>
    run(["hook", name], { stdin: JSON.stringify(event) });

  const choose = (chosen: object) => {
    mkdirSync(join(config, "scratchpad"), { recursive: true });
    writeFileSync(hooksFile(), JSON.stringify(chosen));
  };

  const ids: Record<string, string> = {};
  async function boot() {
    server = await testServer();
    await server.run(
      Effect.gen(function* () {
        const store = yield* Store;
        const made = [
          yield* store.create({ title: "Groceries", body: "milk" }),
          yield* store.create({ title: "Pinned plan", body: "ship it", tags: ["pinned"] }),
          yield* store.create({ title: "Demo conventions", body: "tabs", tags: ["demo"] }),
          yield* store.create({
            title: "SEO checklist",
            body: "x",
            kind: "reference",
            tags: ["seo"],
          }),
          yield* store.create({
            title: "Code style",
            body: "y",
            kind: "reference",
            tags: ["code"],
          }),
        ];
        for (const n of made) ids[n.title] = n.id;
      }),
    );
    config = mkdtempSync(join(tmpdir(), "pad-hook-notes-"));
  }

  /** A git repository named demo-app by its remote, checked out in a folder of another name. */
  function demoRepo() {
    const repo = join(realpathSync(config), "checkout");
    mkdirSync(join(repo, "src"), { recursive: true });
    for (const args of [
      ["init", "-q"],
      ["remote", "add", "origin", "git@github.com:me/demo-app.git"],
    ])
      Bun.spawnSync(["git", "-C", repo, ...args]);
    return repo;
  }

  const sessionContext = async (event: object = {}) =>
    JSON.parse(await hook("session-start", event)).hookSpecificOutput.additionalContext as string;

  test("by default the session lists notes, not references, and the review lists references", async () => {
    await boot();
    const context = await sessionContext();
    expect(context).toContain("## Recent notes");
    expect(context).toContain("Groceries");
    expect(context).not.toContain("SEO checklist");
    expect(context).toContain("aren't loaded here");
  });

  test("this machine's own search decides which notes the session lists", async () => {
    await boot();
    choose({ "session-start": "#pinned" });
    const context = await sessionContext();
    expect(context).toContain("Notes selected by the user (#pinned)");
    expect(context).toContain("Pinned plan");
    expect(context).not.toContain("Groceries");
    // The choice may include references, so the context no longer says they are left out.
    expect(context).not.toContain("aren't loaded here");
  });

  test("this machine's own search decides which references the review offers", async () => {
    await boot();
    choose({ review: "kind:reference #seo" });
    await hook("record-edit", { session_id: "s", tool_input: { file_path: join(ROOT, "a.ts") } });
    const reason = JSON.parse(await hook("review", { session_id: "s", cwd: ROOT }))
      .reason as string;
    expect(reason).toContain("SEO checklist");
    expect(reason).not.toContain("Code style");
  });

  test("pad hooks set chooses for every machine, and --local for this one", async () => {
    await boot();
    expect(await pad("hooks")).toContain("everywhere      kind:note  (default)");

    const set = await pad("hooks", "set", "session-start", "#pinned");
    expect(set).toContain("session-start: #pinned");
    expect(set).toContain("Pinned plan");
    expect(set).not.toContain("Groceries");
    // Kept on the server, not in this machine's file.
    expect(existsSync(hooksFile())).toBe(false);
    expect(await pad("hooks")).toContain("everywhere      #pinned");
    expect(await sessionContext()).toContain("Notes selected by the user (#pinned)");

    await pad("hooks", "set", "review", "kind:reference", "#seo", "--local");
    expect(JSON.parse(readFileSync(hooksFile(), "utf8"))).toEqual({
      review: "kind:reference #seo",
    });
    expect(await pad("hooks")).toContain("this machine    kind:reference #seo");

    await pad("hooks", "reset", "session-start");
    expect(await sessionContext()).toContain("## Recent notes");
    await pad("hooks", "reset", "--local");
    expect(JSON.parse(readFileSync(hooksFile(), "utf8"))).toEqual({});
  });

  test("a repository's choice shows only inside it, as its own section", async () => {
    await boot();
    const repo = demoRepo();
    const set = await padIn(repo, "hooks", "set", "session-start", "#demo", "--here");
    expect(set).toContain("session-start (demo-app): #demo");
    expect(set).toContain("Demo conventions");

    const inside = await sessionContext({ cwd: join(repo, "src") });
    expect(inside).toContain("## Notes for demo-app (#demo)");
    expect(inside).toContain("## Recent notes");
    // Shown in the repository's section, so not again in the recent ones.
    expect(inside.split("Demo conventions").length).toBe(2);

    const elsewhere = await sessionContext({ cwd: ROOT });
    expect(elsewhere).not.toContain("demo-app");
  });

  test("hand-picked notes are listed first and marked, and can be unpicked", async () => {
    await boot();
    const picked = await pad("hooks", "include", "session-start", ids["SEO checklist"]!);
    expect(picked).toContain("SEO checklist");
    const context = await sessionContext();
    expect(context).toContain(`SEO checklist (id: ${ids["SEO checklist"]}, human,`);
    expect(context).toContain("hand-picked)");

    await pad("hooks", "exclude", "session-start", ids["SEO checklist"]!);
    expect(await sessionContext()).not.toContain("SEO checklist");
  });

  test("pad hooks preview shows what a hook shows where it runs", async () => {
    await boot();
    const repo = demoRepo();
    await pad("hooks", "set", "review", "#code", "--scope", "demo-app");
    const here = await padIn(repo, "hooks", "preview", "review");
    expect(here).toContain("## Notes for demo-app (#code)");
    expect(here).toContain("Code style");
    expect(await pad("hooks", "preview", "review")).not.toContain("demo-app");
  });

  test("pad hooks push moves this machine's searches to the server", async () => {
    await boot();
    choose({ "session-start": "#pinned" });
    expect(await pad("hooks", "push")).toContain("session-start: #pinned");
    expect(JSON.parse(readFileSync(hooksFile(), "utf8"))).toEqual({});
    expect(await pad("hooks")).toContain("everywhere      #pinned");
    expect(await sessionContext()).toContain("Notes selected by the user (#pinned)");
  });

  test("a choice that matches nothing says so", async () => {
    await boot();
    expect(await pad("hooks", "set", "review", "#nothing")).toContain("no notes match");
  });

  test("logging out keeps this machine's choices", async () => {
    await boot();
    await pad("hooks", "set", "review", "#seo", "--local");
    await pad("logout");
    expect(existsSync(hooksFile())).toBe(true);
  });

  test("against a server older than hook selections, the hooks work as before", async () => {
    config = mkdtempSync(join(tmpdir(), "pad-hook-notes-"));
    const searched: string[] = [];
    const old = {
      id: "old1234567",
      title: "From an old server",
      body: "",
      tags: [],
      kind: "note",
      author: "human",
      created_at: "2026-09-01T00:00:00.000Z",
      updated_at: "2026-09-01T00:00:00.000Z",
      progress: { done: 0, total: 0 },
    };
    stub = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/api/notes") {
          searched.push(url.searchParams.get("q") ?? "");
          return Response.json([old]);
        }
        return Response.json({ error: "notFound", message: "No such endpoint" }, { status: 404 });
      },
    });
    expect(await sessionContext()).toContain("## Recent notes\n- From an old server");
    choose({ "session-start": "#pinned" });
    expect(await sessionContext()).toContain("Notes selected by the user (#pinned)");
    expect(searched).toEqual(["kind:note", "#pinned"]);
  });
});
