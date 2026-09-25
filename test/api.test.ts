import { afterEach, describe, expect, test } from "bun:test";

import { type Note, Store } from "../src/db";
import { createServer } from "../src/server";

let server: ReturnType<typeof createServer> | undefined;

// A real server on a random port: the route table only exists inside Bun.serve.
function boot(token?: string) {
  server = createServer({ store: new Store(":memory:"), token });
  return server;
}

afterEach(async () => {
  await server?.stop(true);
  server = undefined;
});

async function call(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const s = server ?? boot();
  const init: RequestInit = { method, headers: { ...headers } };
  if (typeof body === "string") init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { ...headers, "content-type": "application/json" };
  }
  const res = await fetch(new URL(path, s.url), init);
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, headers: res.headers, data };
}

describe("notes API", () => {
  test("create, get, list", async () => {
    const { status, data } = await call("POST", "/api/notes", {
      body: "# Groceries\nmilk",
      tags: ["Home", "home"],
    });
    expect(status).toBe(201);
    const note = data as Note;
    expect(note.title).toBe("Groceries");
    expect(note.tags).toEqual(["home"]);
    expect(note.author).toBe("human");

    expect((await call("GET", `/api/notes/${note.id}`)).data.body).toBe("# Groceries\nmilk");
    expect((await call("GET", "/api/notes")).data).toHaveLength(1);
  });

  test("text/plain body and author attribution", async () => {
    const { data } = await call("POST", "/api/notes", "quick thought", {
      "x-pad-author": "claude-code",
    });
    expect(data.body).toBe("quick thought");
    expect(data.author).toBe("claude-code");
  });

  test("full-text search with prefix match, tag and pinned filters", async () => {
    await call("POST", "/api/notes", { body: "rotate the database credentials", tags: ["ops"] });
    await call("POST", "/api/notes", { body: "buy coffee", pinned: true });
    expect((await call("GET", "/api/notes?q=datab")).data).toHaveLength(1);
    expect((await call("GET", `/api/notes?q=${encodeURIComponent('"weird (syntax')}`)).status).toBe(
      200,
    );
    expect((await call("GET", "/api/notes?tag=ops")).data[0].body).toContain("database");
    expect((await call("GET", "/api/notes?pinned=true")).data[0].body).toBe("buy coffee");
    expect((await call("GET", "/api/tags")).data).toEqual([{ tag: "ops", count: 1 }]);
  });

  test("pinned notes sort first", async () => {
    await call("POST", "/api/notes", { body: "pinned one", pinned: true });
    await call("POST", "/api/notes", { body: "newer" });
    expect((await call("GET", "/api/notes")).data[0].body).toBe("pinned one");
  });

  test("notes report checkbox progress, kept current on every write", async () => {
    const { data: n } = await call("POST", "/api/notes", { body: "- [x] a\n- [ ] b" });
    expect(n.progress).toEqual({ done: 1, total: 2 });
    const patched = (await call("PATCH", `/api/notes/${n.id}`, { body: "- [x] a\n- [x] b" })).data;
    expect(patched.progress).toEqual({ done: 2, total: 2 });
    const appended = (await call("POST", `/api/notes/${n.id}/append`, "- [ ] c")).data;
    expect(appended.progress).toEqual({ done: 2, total: 3 });
    expect((await call("GET", "/api/notes")).data[0].progress).toEqual({ done: 2, total: 3 });
  });

  test("daily review: created once per date, carrying over open items", async () => {
    const first = await call("PUT", "/api/daily/2026-09-24");
    expect(first.status).toBe(201);
    expect(first.data).toMatchObject({
      title: "Daily review 2026-09-24",
      tags: ["daily"],
      kind: "note",
    });
    const again = await call("PUT", "/api/daily/2026-09-24");
    expect([again.status, again.data.id]).toEqual([200, first.data.id]);

    await call("PATCH", `/api/notes/${first.data.id}`, {
      body: "## Tomorrow\n- [ ] ship the list\n- [x] write tests",
    });
    const next = await call("PUT", "/api/daily/2026-09-25", undefined, {
      "x-pad-author": "claude-code",
    });
    expect(next.status).toBe(201);
    expect(next.data.author).toBe("claude-code");
    expect(next.data.body).toContain("- [ ] ship the list");
    expect(next.data.body).not.toContain("write tests");
  });

  test("kind defaults to note and can be set on create and patch", async () => {
    const { data: n } = await call("POST", "/api/notes", { body: "a note" });
    expect(n.kind).toBe("note");
    const { data: r } = await call("POST", "/api/notes", { body: "rules", kind: "reference" });
    expect(r.kind).toBe("reference");
    expect((await call("PATCH", `/api/notes/${n.id}`, { kind: "reference" })).data.kind).toBe(
      "reference",
    );
  });

  test("filters by kind, by several tags, and by operators in q", async () => {
    const note = (body: string, kind: string, tags: string[]) =>
      call("POST", "/api/notes", { body, kind, tags });
    await note("Launch checklist: domain, analytics", "reference", ["checklist", "launch"]);
    await note("SEO checklist: sitemap", "reference", ["checklist", "seo"]);
    await note("Tasks: launch the portfolio", "note", ["tasks", "launch"]);
    const titles = async (qs: string) =>
      ((await call("GET", `/api/notes?${qs}`)).data as Note[]).map((n) => n.title).sort();

    expect(await titles("kind=reference")).toEqual([
      "Launch checklist: domain, analytics",
      "SEO checklist: sitemap",
    ]);
    expect(await titles("tag=checklist&tag=launch")).toEqual([
      "Launch checklist: domain, analytics",
    ]);
    expect(await titles(`q=${encodeURIComponent("kind:reference #launch")}`)).toEqual([
      "Launch checklist: domain, analytics",
    ]);
    expect(await titles(`q=${encodeURIComponent("#launch portfolio")}`)).toEqual([
      "Tasks: launch the portfolio",
    ]);
    // A kind typed into the search box is forgiving: it just matches nothing.
    expect(await titles(`q=${encodeURIComponent("kind:refer")}`)).toEqual([]);
  });

  test("patch, append, delete", async () => {
    const { data: n } = await call("POST", "/api/notes", { body: "log" });
    const patched = (
      await call("PATCH", `/api/notes/${n.id}`, { title: "Build log", pinned: true })
    ).data;
    expect(patched).toMatchObject({ title: "Build log", pinned: true, body: "log" });

    await call("POST", `/api/notes/${n.id}/append`, { text: "step 1 ok" });
    const appended = (await call("POST", `/api/notes/${n.id}/append`, "step 2 ok")).data;
    expect(appended.body).toBe("log\nstep 1 ok\nstep 2 ok");
    // Search index follows updates.
    expect((await call("GET", "/api/notes?q=step")).data).toHaveLength(1);

    expect((await call("DELETE", `/api/notes/${n.id}`)).status).toBe(204);
    expect((await call("GET", `/api/notes/${n.id}`)).status).toBe(404);
    expect((await call("GET", "/api/notes?q=step")).data).toHaveLength(0);
  });

  test("errors carry a stable code and a readable message", async () => {
    const cases: [string, string, unknown, number, string][] = [
      ["POST", "/api/notes", { body: "" }, 400, "emptyNote"],
      ["POST", "/api/notes", { body: 1 }, 400, "invalidBody"],
      ["POST", "/api/notes", { tags: [1] }, 400, "invalidBody"],
      ["POST", "/api/notes", { body: "x", kind: "checklist" }, 400, "invalidKind"],
      ["GET", "/api/notes?kind=checklist", undefined, 400, "invalidKind"],
      ["PUT", "/api/daily/2026-02-30", undefined, 400, "invalidDate"],
      ["PUT", "/api/daily/today", undefined, 400, "invalidDate"],
      ["PATCH", "/api/notes/nope", { body: "x" }, 404, "noteNotFound"],
      ["DELETE", "/api/notes/nope", undefined, 404, "noteNotFound"],
      ["POST", "/api/notes/nope/append", "x", 404, "noteNotFound"],
      ["POST", "/api/notes/nope/append", "", 400, "emptyAppend"],
      ["GET", "/api/nothing-here", undefined, 404, "notFound"],
    ];
    for (const [method, path, body, status, code] of cases) {
      const res = await call(method, path, body);
      expect([method, path, res.status, res.data.error]).toEqual([method, path, status, code]);
      expect(typeof res.data.message).toBe("string");
    }
    const bad = await fetch(new URL("/api/notes", server!.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{nope",
    });
    expect((await bad.json()).error).toBe("invalidJson");
  });

  test("wrong method is 405 with Allow", async () => {
    const res = await call("PUT", "/api/notes");
    expect(res.status).toBe(405);
    expect(res.data.error).toBe("methodNotAllowed");
    expect(res.headers.get("allow")).toBe("GET, POST");
  });

  test("bearer token auth", async () => {
    boot("s3cret");
    expect((await call("GET", "/api/health")).status).toBe(200);
    const denied = await call("GET", "/api/notes");
    expect([denied.status, denied.data.error]).toEqual([401, "unauthorized"]);
    expect(
      (await call("GET", "/api/notes", undefined, { authorization: "Bearer wrong" })).status,
    ).toBe(401);
    expect(
      (await call("GET", "/api/notes", undefined, { authorization: "Bearer s3cret" })).status,
    ).toBe(200);
  });

  test("discovery endpoints and PWA files", async () => {
    expect((await call("GET", "/openapi.json")).data.paths["/api/notes"]).toBeDefined();
    const llms = await call("GET", "/llms.txt");
    expect(llms.data).toContain(`${server!.url.origin}/api/notes`);
    const sw = await call("GET", "/sw.js");
    expect([sw.status, sw.headers.get("cache-control")]).toEqual([200, "no-cache"]);
    expect((await call("GET", "/manifest.webmanifest")).headers.get("content-type")).toBe(
      "application/manifest+json",
    );
  });
});
