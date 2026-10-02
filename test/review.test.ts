import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as Effect from "effect/Effect";

import { editedFile, editsPath, MAX_FILES, reviewReason } from "../integrations/claude-code/review";
import { Store } from "../src/db";
import { type TestServer, testServer } from "./support";

const ROOT = join(import.meta.dir, "..");

describe("review helpers", () => {
  test("editedFile reads the path from Edit/Write and NotebookEdit events", () => {
    expect(editedFile({ tool_input: { file_path: "/r/a.ts" } })).toBe("/r/a.ts");
    expect(editedFile({ tool_input: { notebook_path: "/r/n.ipynb" } })).toBe("/r/n.ipynb");
    expect(editedFile({ tool_input: {} })).toBeUndefined();
    expect(editedFile(null)).toBeUndefined();
  });

  test("editsPath keeps a session id from escaping the cache folder", () => {
    expect(editsPath("../../etc/x", "/c")).toBe("/c/scratchpad/edits/______etc_x.txt");
  });

  test("reviewReason lists files relative to the repo, once each, and titles only", () => {
    const reason = reviewReason({
      files: ["/r/src/a.ts", "/r/src/a.ts", "/elsewhere/b.md"],
      cwd: "/r",
      repo: "my-repo",
      notes: [{ id: "n1", title: "SEO checklist", tags: ["seo", "web"] }],
    });
    expect(reason).toContain("in my-repo:\n- src/a.ts\n- /elsewhere/b.md\n");
    expect(reason).toContain("- SEO checklist (id: n1) #seo #web");
    expect(reason).toContain("pad-review");
  });

  test("reviewReason caps a long file list", () => {
    const files = Array.from({ length: MAX_FILES + 5 }, (_, i) => `/r/f${i}.ts`);
    const reason = reviewReason({ files, cwd: "/r", repo: "r", notes: [] });
    expect(reason).toContain("… and 5 more");
    expect(reason).not.toContain(`f${MAX_FILES}.ts`);
  });
});

describe("review hooks, end to end", () => {
  let server: TestServer | undefined;
  let cache = "";
  afterEach(async () => {
    await server?.stop();
    rmSync(cache, { recursive: true, force: true });
  });

  // Runs a hook script the way Claude Code does: the event as JSON on stdin, output on stdout.
  async function hook(script: string, event: object, env: Record<string, string> = {}) {
    const proc = Bun.spawn(["bun", join(ROOT, "integrations/claude-code", script)], {
      stdin: new Blob([JSON.stringify(event)]),
      stdout: "pipe",
      env: {
        ...process.env,
        PAD_URL: server!.url.origin,
        PAD_TOKEN: "",
        // Keeps the real ~/.config (and its token) and ~/.cache out of the test.
        XDG_CONFIG_HOME: cache,
        XDG_CACHE_HOME: cache,
        ...env,
      },
    });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    return out.trim();
  }

  async function boot() {
    server = await testServer();
    await server.run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* store.create({
          title: "SEO checklist",
          body: "- [ ] sitemap",
          kind: "reference",
          tags: ["seo"],
        });
        yield* store.create({ title: "Groceries", body: "milk" });
      }),
    );
    cache = mkdtempSync(join(tmpdir(), "pad-review-"));
  }

  const edit = (session: string, file: string) =>
    hook("record-edit.ts", {
      session_id: session,
      tool_name: "Edit",
      tool_input: { file_path: file },
    });
  const stop = (session: string, active = false, env?: Record<string, string>) =>
    hook("review-hook.ts", { session_id: session, stop_hook_active: active, cwd: ROOT }, env);

  test("blocks once after edits, listing the files and reference titles", async () => {
    await boot();
    await edit("s1", join(ROOT, "src/web/App.tsx"));
    const out = JSON.parse(await stop("s1"));
    expect(out.decision).toBe("block");
    expect(out.reason).toContain("- src/web/App.tsx");
    expect(out.reason).toContain("SEO checklist");
    expect(out.reason).not.toContain("Groceries");
    // Nothing edited since: Claude may stop.
    expect(await stop("s1")).toBe("");
  });

  test("edits made while answering the review don't start another one", async () => {
    await boot();
    await edit("s2", join(ROOT, "a.ts"));
    await stop("s2");
    await edit("s2", join(ROOT, "a.ts"));
    expect(await stop("s2", true)).toBe("");
    expect(await stop("s2")).toBe("");
  });

  test("stays silent without edits, and when turned off", async () => {
    await boot();
    expect(await stop("s3")).toBe("");
    await edit("s4", join(ROOT, "a.ts"));
    expect(await stop("s4", false, { PAD_REVIEW: "off" })).toBe("");
  });
});
