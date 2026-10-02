import { afterEach, describe, expect, test } from "bun:test";

import { type TestServer, testServer } from "@test/support";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import type { Note } from "@/shared/domain";

let server: TestServer | undefined;

// A real server on a random port: the route table only exists inside Bun.serve.
async function boot(token?: string) {
  server = await testServer({ token });
  return server;
}

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

async function call(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const s = server ?? (await boot());
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

  test("full-text search with prefix match and tag filters", async () => {
    await call("POST", "/api/notes", { body: "rotate the database credentials", tags: ["ops"] });
    await call("POST", "/api/notes", { body: "buy coffee" });
    expect((await call("GET", "/api/notes?q=datab")).data).toHaveLength(1);
    expect((await call("GET", `/api/notes?q=${encodeURIComponent('"weird (syntax')}`)).status).toBe(
      200,
    );
    expect((await call("GET", "/api/notes?tag=ops")).data[0].body).toContain("database");
    expect((await call("GET", "/api/tags")).data).toEqual([{ tag: "ops", count: 1 }]);
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

  test("filters by who created the note: human, any agent, or one by name", async () => {
    const note = (body: string, author?: string) =>
      call("POST", "/api/notes", { body }, author ? { "x-pad-author": author } : {});
    await note("mine");
    await note("from claude", "claude-code");
    await note("from another agent", "Other-Bot");
    const bodies = async (qs: string) =>
      ((await call("GET", `/api/notes?${qs}`)).data as Note[]).map((n) => n.body).sort();

    expect(await bodies("author=human")).toEqual(["mine"]);
    expect(await bodies("author=agent")).toEqual(["from another agent", "from claude"]);
    expect(await bodies("author=claude-code")).toEqual(["from claude"]);
    expect(await bodies(`q=${encodeURIComponent("author:other-bot")}`)).toEqual([
      "from another agent",
    ]);
    expect(await bodies(`q=${encodeURIComponent("author:agent claude")}`)).toEqual(["from claude"]);
  });

  test("saved views: create, list by name, delete", async () => {
    const made = await call("POST", "/api/views", {
      name: " Agent logs ",
      query: "author:agent #log",
    });
    expect(made.status).toBe(201);
    expect(made.data).toMatchObject({ name: "Agent logs", query: "author:agent #log" });
    await call("POST", "/api/views", { name: "Checklists", query: "kind:reference" });

    expect(
      ((await call("GET", "/api/views")).data as { name: string }[]).map((v) => v.name),
    ).toEqual(["Agent logs", "Checklists"]);
    const cases: [string, string, unknown, number, string][] = [
      ["POST", "/api/views", { name: "agent LOGS", query: "x" }, 409, "viewExists"],
      ["POST", "/api/views", { name: "", query: "x" }, 400, "invalidBody"],
      ["POST", "/api/views", { name: "x" }, 400, "invalidBody"],
      ["POST", "/api/views", "{nope", 400, "invalidJson"],
      ["DELETE", "/api/views/nope", undefined, 404, "viewNotFound"],
    ];
    for (const [method, path, body, status, code] of cases) {
      const json: Record<string, string> =
        typeof body === "string" ? { "content-type": "application/json" } : {};
      const res = await call(method, path, body, json);
      expect([method, path, res.status, res.data.error]).toEqual([method, path, status, code]);
    }
    expect((await call("DELETE", `/api/views/${made.data.id}`)).status).toBe(204);
    expect((await call("GET", "/api/views")).data).toHaveLength(1);
  });

  test("pins: at most three, in the order pinned, without touching the note", async () => {
    const ids: string[] = [];
    for (const body of ["a", "b", "c", "d"])
      ids.push((await call("POST", "/api/notes", { body })).data.id);
    const [a, b, c, d] = ids as [string, string, string, string];
    const before = (await call("GET", `/api/notes/${b}`)).data;

    for (const id of [b, a, c]) expect((await call("PUT", `/api/pins/${id}`)).status).toBe(204);
    // Already pinned: no change, and no limit hit.
    expect((await call("PUT", `/api/pins/${a}`)).status).toBe(204);
    const pinned = async () => ((await call("GET", "/api/pins")).data as Note[]).map((n) => n.body);
    expect(await pinned()).toEqual(["b", "a", "c"]);
    expect((await call("GET", `/api/notes/${b}`)).data).toEqual(before);
    expect((await call("GET", `/api/notes/${b}/revisions`)).data).toHaveLength(1);

    const refused = await call("PUT", `/api/pins/${d}`);
    expect([refused.status, refused.data.error]).toEqual([409, "pinLimit"]);
    for (const method of ["PUT", "DELETE"]) {
      const res = await call(method, "/api/pins/nope");
      expect([method, res.status, res.data.error]).toEqual([method, 404, "noteNotFound"]);
    }

    expect((await call("DELETE", `/api/pins/${a}`)).status).toBe(204);
    expect((await call("DELETE", `/api/pins/${a}`)).status).toBe(204);
    expect((await call("PUT", `/api/pins/${d}`)).status).toBe(204);
    // A deleted note leaves its pin behind with it.
    await call("DELETE", `/api/notes/${c}`);
    expect(await pinned()).toEqual(["b", "d"]);
  });

  test("patch, append, delete", async () => {
    const { data: n } = await call("POST", "/api/notes", { body: "log" });
    const patched = (
      await call("PATCH", `/api/notes/${n.id}`, { title: "Build log", tags: ["log"] })
    ).data;
    expect(patched).toMatchObject({ title: "Build log", tags: ["log"], body: "log" });

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
    await boot("s3cret");
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

  test("history: revisions per author, diffs between them", async () => {
    const { data: n } = await call("POST", "/api/notes", { body: "# Plan\n- one" });
    // The same author saving again soon is the same editing session.
    await call("PATCH", `/api/notes/${n.id}`, { body: "# Plan\n- one\n- two" });
    await call("POST", `/api/notes/${n.id}/append`, "- three", { "x-pad-author": "claude-code" });
    // A save that changes nothing isn't an edit.
    await call("PATCH", `/api/notes/${n.id}`, { title: "Plan" }, { "x-pad-author": "claude-code" });

    const { data: revs } = await call("GET", `/api/notes/${n.id}/revisions`);
    expect(revs.map((r: any) => [r.author, r.added, r.removed])).toEqual([
      ["claude-code", 1, 0],
      ["human", 3, 0],
    ]);
    expect(revs[0].body).toBeUndefined();

    const latest = await call("GET", `/api/notes/${n.id}/diff`);
    expect(latest.data.from.id).toBe(revs[1].id);
    expect(latest.data.to.id).toBe(revs[0].id);
    expect(latest.data.changes).toEqual({});
    expect(latest.data.diff).toContain("\n+- three\n");

    const first = await call("GET", `/api/notes/${n.id}/diff?to=${revs[1].id}`);
    expect(first.data.from).toBeNull();
    expect(first.data.changes.title).toEqual({ from: null, to: "Plan" });
    expect(first.data.diff).toContain("@@ -0,0 +1,3 @@");

    const full = await call("GET", `/api/notes/${n.id}/revisions/${revs[1].id}`);
    expect(full.data.body).toBe("# Plan\n- one\n- two");

    // Since a time before the note existed, everything is new; since now, nothing is.
    const before = await call("GET", `/api/notes/${n.id}/diff?since=2000-01-01T00:00:00Z`);
    expect(before.data.from).toBeNull();
    const now = await call("GET", `/api/notes/${n.id}/diff?since=${new Date().toISOString()}`);
    expect(now.data.diff).toBe("");
  });

  test("history errors", async () => {
    const { data: n } = await call("POST", "/api/notes", { body: "x" });
    const cases: [string, number, string][] = [
      ["/api/notes/nope/revisions", 404, "noteNotFound"],
      ["/api/notes/nope/diff", 404, "noteNotFound"],
      [`/api/notes/${n.id}/revisions/999`, 404, "revisionNotFound"],
      [`/api/notes/${n.id}/diff?from=999`, 404, "revisionNotFound"],
      [`/api/notes/${n.id}/diff?to=abc`, 400, "invalidParam"],
      [`/api/notes/${n.id}/diff?since=yesterday`, 400, "invalidParam"],
      [`/api/notes/${n.id}/diff?from=1&since=2026-01-01`, 400, "invalidParam"],
    ];
    for (const [path, status, code] of cases) {
      const res = await call("GET", path);
      expect([path, res.status, res.data.error]).toEqual([path, status, code]);
    }
  });

  test("deleting a note deletes its history", async () => {
    const { data: n } = await call("POST", "/api/notes", { body: "x" });
    await call("DELETE", `/api/notes/${n.id}`);
    const rows = await server!.run(
      Effect.flatMap(SqlClient.SqlClient, (sql) => sql`SELECT COUNT(*) AS n FROM note_revisions`),
    );
    expect(rows).toEqual([{ n: 0 }]);
  });

  test("If-Match: a write based on an old version is refused", async () => {
    const { data: n, headers } = await call("POST", "/api/notes", { body: "v1" });
    expect(headers.get("etag")).toBe(`"${n.updated_at}"`);

    const ok = await call(
      "PATCH",
      `/api/notes/${n.id}`,
      { body: "v2" },
      { "if-match": `"${n.updated_at}"` },
    );
    expect(ok.status).toBe(200);
    const stale = await call(
      "PATCH",
      `/api/notes/${n.id}`,
      { body: "v3" },
      { "if-match": n.updated_at },
    );
    expect([stale.status, stale.data.error]).toEqual([412, "noteChanged"]);
    expect((await call("GET", `/api/notes/${n.id}`)).data.body).toBe("v2");
    expect(
      (await call("PATCH", `/api/notes/${n.id}`, { body: "v4" }, { "if-match": "*" })).status,
    ).toBe(200);
  });

  test("concurrent appends to one note all land", async () => {
    const { data: n } = await call("POST", "/api/notes", { body: "log" });
    const lines = Array.from({ length: 25 }, (_, i) => `line ${i}`);
    await Promise.all(lines.map((line) => call("POST", `/api/notes/${n.id}/append`, line)));
    const body: string = (await call("GET", `/api/notes/${n.id}`)).data.body;
    expect(body.split("\n").toSorted()).toEqual(["log", ...lines].toSorted());
  });

  test("of two writes based on the same version, exactly one wins", async () => {
    const { data: n } = await call("POST", "/api/notes", { body: "v1" });
    const ifMatch = { "if-match": `"${n.updated_at}"` };
    const results = await Promise.all([
      call("PATCH", `/api/notes/${n.id}`, { body: "left" }, ifMatch),
      call("PATCH", `/api/notes/${n.id}`, { body: "right" }, ifMatch),
    ]);
    expect(results.map((r) => r.status).toSorted((a, b) => a - b)).toEqual([200, 412]);
  });

  test("a client-chosen id makes a create safe to retry", async () => {
    const first = await call("POST", "/api/notes", { id: "offline-note-1", body: "made offline" });
    expect([first.status, first.data.id]).toEqual([201, "offline-note-1"]);
    const again = await call("POST", "/api/notes", { id: "offline-note-1", body: "made offline" });
    expect([again.status, again.data.error]).toEqual([409, "noteExists"]);
    const bad = await call("POST", "/api/notes", { id: "a/b", body: "x" });
    expect([bad.status, bad.data.error]).toEqual([400, "invalidBody"]);
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
