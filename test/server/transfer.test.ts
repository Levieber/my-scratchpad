import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";

import { ROOT, type TestServer, testServer } from "@test/support";

import { ARCHIVE_VERSION } from "@/shared/archive";
import type { FullRevision, Note, Revision } from "@/shared/domain";
import { MAX_PINS } from "@/shared/pins";

const servers: TestServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.stop()));
});

/** A server on a fresh database, and a way to call it. */
async function boot(options: { token?: string; maxImportBytes?: number } = {}) {
  const server = await testServer(options);
  servers.push(server);
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const init: RequestInit = { method, headers: { ...headers } };
    if (typeof body === "string") init.body = body;
    else if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers = { ...headers, "content-type": "application/json" };
    }
    const res = await fetch(new URL(path, server.url), init);
    const text = await res.text();
    let data: any = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {}
    return { status: res.status, headers: res.headers, data };
  };
  return { call, server };
}

const fixture = (name: string) => Bun.file(join(ROOT, "test/fixtures", name)).text();

/** A note with a history of three revisions by two authors, a view, a pin and a hook selection. */
async function seed(call: Awaited<ReturnType<typeof boot>>["call"]) {
  const a = (
    await call(
      "POST",
      "/api/notes",
      { id: "seed-note-0001", body: "# Plan\n- [ ] one", tags: ["plan"] },
      { "x-pad-author": "human" },
    )
  ).data as Note;
  await call(
    "PATCH",
    `/api/notes/${a.id}`,
    { body: "# Plan\n- [ ] one\n- [ ] two" },
    { "x-pad-author": "claude-code" },
  );
  await call(
    "PATCH",
    `/api/notes/${a.id}`,
    { body: "# Plan\n- [x] one\n- [ ] two" },
    { "x-pad-author": "human" },
  );
  const b = (
    await call(
      "POST",
      "/api/notes",
      { id: "seed-note-0002", title: "Rules", body: "Small steps.", kind: "reference" },
      { "x-pad-author": "claude-code" },
    )
  ).data as Note;
  await call("POST", "/api/views", { name: "Plans", query: "#plan" });
  await call("PUT", `/api/pins/${b.id}`);
  await call("PUT", `/api/pins/${a.id}`);
  await call("PUT", "/api/hooks/review", { include: [b.id], limit: 40 });
  return { a, b };
}

const history = async (call: Awaited<ReturnType<typeof boot>>["call"], id: string) => {
  const revisions = (await call("GET", `/api/notes/${id}/revisions`)).data as Revision[];
  const full = await Promise.all(
    revisions.map(
      async (r) => (await call("GET", `/api/notes/${id}/revisions/${r.id}`)).data as FullRevision,
    ),
  );
  // The database's own ids and note ids are not part of what an archive carries.
  return full.map((revision) => {
    const { id: _, note_id: __, ...rest } = revision;
    return rest;
  });
};

describe("GET /api/export", () => {
  test("writes an archive of every note with its history, views, pins and hook selections", async () => {
    const { call } = await boot();
    const { a, b } = await seed(call);

    const res = await call("GET", "/api/export");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="pad-export-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    expect(res.data).toMatchObject({ format: "pad-export", version: ARCHIVE_VERSION });
    expect(Date.parse(res.data.exported_at)).not.toBeNaN();
    expect(res.data.source.app_version).toBeString();

    const notes = res.data.notes as (Note & { revisions: unknown[] })[];
    const exported = notes.find((n) => n.id === a.id);
    expect(notes.map((n) => n.id).sort()).toEqual([a.id, b.id]);
    expect(exported).toMatchObject({ author: "human", created_at: a.created_at, tags: ["plan"] });
    expect(exported).not.toHaveProperty("progress");
    expect(exported?.revisions).toEqual(await history(call, a.id).then((h) => h.reverse()));
    expect(res.data.views.map((v: { name: string }) => v.name)).toEqual(["Plans"]);
    expect(res.data.pins.map((p: { note_id: string }) => p.note_id)).toEqual([b.id, a.id]);
    expect(res.data.hook_selections).toMatchObject([
      { hook: "review", include: [b.id], limit: 40 },
    ]);
  });

  test("history=false leaves the revisions out", async () => {
    const { call } = await boot();
    await seed(call);
    const { data } = await call("GET", "/api/export?history=false");
    expect(data.notes).toHaveLength(2);
    for (const note of data.notes) expect(note).not.toHaveProperty("revisions");
  });

  test("filters pick the notes; views and hook selections stay out and pins follow the notes", async () => {
    const { call } = await boot();
    const { a } = await seed(call);
    const { data } = await call("GET", "/api/export?tag=plan");
    expect(data.notes.map((n: Note) => n.id)).toEqual([a.id]);
    expect(data.views).toEqual([]);
    expect(data.hook_selections).toEqual([]);
    expect(data.pins.map((p: { note_id: string }) => p.note_id)).toEqual([a.id]);
    expect((await call("GET", "/api/export?kind=diary")).data.error).toBe("invalidKind");
  });

  test("reads past one page of notes", async () => {
    const { call } = await boot();
    const batch = Array.from({ length: 501 }, (_, i) => ({
      id: `bulk-note-${String(i).padStart(4, "0")}`,
      body: `n${i}`,
    }));
    await call("POST", "/api/import", batch);
    expect((await call("GET", "/api/export?history=false")).data.notes).toHaveLength(501);
  });

  test("needs the token like every other endpoint", async () => {
    const { call } = await boot({ token: "secret" });
    expect((await call("GET", "/api/export")).status).toBe(401);
    expect(
      (await call("GET", "/api/export", undefined, { authorization: "Bearer secret" })).status,
    ).toBe(200);
  });
});

describe("POST /api/import", () => {
  test("an export imported into another server keeps history, authors, dates, pins, views and hook selections", async () => {
    const source = await boot();
    const { a, b } = await seed(source.call);
    const archive = (await source.call("GET", "/api/export")).data;

    const target = await boot();
    const result = await target.call("POST", "/api/import", archive);
    expect(result.status).toBe(200);
    expect(result.data).toMatchObject({
      created: 2,
      skipped: 0,
      failed: [],
      views: { created: 1, skipped: 0 },
      pins: { created: 2, skipped: 0 },
      hook_selections: { created: 1, skipped: 0 },
    });

    for (const original of [a, b]) {
      const copy = (await target.call("GET", `/api/notes/${original.id}`)).data as Note;
      const now = (await source.call("GET", `/api/notes/${original.id}`)).data as Note;
      expect(copy).toEqual(now);
      expect(await history(target.call, original.id)).toEqual(
        await history(source.call, original.id),
      );
    }
    // A revision's number is the database's own, so it may differ; what changed may not.
    const diff = async (s: typeof source) =>
      (await s.call("GET", `/api/notes/${a.id}/diff`)).data.diff.replace(
        /revision \d+/g,
        "revision",
      );
    expect(await diff(target)).toBe(await diff(source));
    expect((await target.call("GET", "/api/pins")).data.map((n: Note) => n.id)).toEqual([
      b.id,
      a.id,
    ]);
    expect(
      (await target.call("GET", "/api/views")).data.map((v: { name: string }) => v.name),
    ).toEqual(["Plans"]);
    expect(
      (await target.call("GET", "/api/hooks")).data.hooks.find(
        (h: { name: string }) => h.name === "review",
      ).selections,
    ).toMatchObject([{ include: [b.id], limit: 40 }]);
  });

  test("imported notes are found by search and appear to a client that was polling", async () => {
    const { call } = await boot();
    const before = await call("GET", "/api/notes");
    const etag = before.headers.get("etag") ?? "";
    await call("POST", "/api/import", [
      { id: "found-note-0001", body: "zebra crossing", updated_at: "2020-01-01T00:00:00.000Z" },
    ]);
    const polled = await call("GET", "/api/notes", undefined, { "if-none-match": etag });
    expect(polled.status).toBe(200);
    expect((await call("GET", "/api/notes?q=zebra")).data.map((n: Note) => n.id)).toEqual([
      "found-note-0001",
    ]);
  });

  test("a version 1 file still imports, keeping each note's author and dates", async () => {
    const { call } = await boot();
    const result = await call("POST", "/api/import", JSON.parse(await fixture("export-v1.json")));
    expect(result.data).toMatchObject({ created: 2, skipped: 0, failed: [] });
    const note = (await call("GET", "/api/notes/legacy-note-0001")).data as Note;
    expect(note).toMatchObject({
      author: "human",
      kind: "reference",
      created_at: "2026-08-01T09:00:00.000Z",
      updated_at: "2026-08-03T18:30:00.000Z",
      progress: { done: 1, total: 2 },
    });
    // No history in the file: the note's history starts at what it is.
    const revisions = (await call("GET", "/api/notes/legacy-note-0002/revisions"))
      .data as Revision[];
    expect(revisions).toMatchObject([
      { author: "claude-code", updated_at: "2026-08-02T10:00:00.000Z" },
    ]);
  });

  test("the version 2 fixture imports whole, and what its version left out of an item is ignored", async () => {
    const { call } = await boot();
    const result = await call("POST", "/api/import", JSON.parse(await fixture("export-v2.json")));
    expect(result.data).toMatchObject({
      created: 2,
      skipped: 0,
      failed: [],
      views: { created: 1 },
      pins: { created: 2 },
      hook_selections: { created: 1 },
    });
    expect(
      (await history(call, "archive-note-0001")).map((r) => [
        r.author,
        r.body.split("\n").length,
        r.updated_at,
      ]),
    ).toEqual([
      ["human", 3, "2026-09-03T08:00:00.000Z"],
      ["claude-code", 3, "2026-09-02T08:00:00.000Z"],
      ["human", 2, "2026-09-01T08:00:00.000Z"],
    ]);
    expect((await call("GET", "/api/pins")).data.map((n: Note) => n.id)).toEqual([
      "archive-note-0002",
      "archive-note-0001",
    ]);
    const [selection] = (await call("GET", "/api/hooks")).data.hooks.find(
      (h: { name: string }) => h.name === "review",
    ).selections;
    // A hand-picked note that is not here is dropped, as when a picked note is deleted.
    expect(selection).toMatchObject({
      include: ["archive-note-0002"],
      limit: 50,
      updated_by: "human",
    });
    expect((await call("GET", "/api/views")).data[0]).toMatchObject({
      id: "archive-view-0001",
      created_at: "2026-09-05T08:00:00.000Z",
    });
  });

  test("importing the same archive twice changes nothing the second time", async () => {
    const { call } = await boot();
    const archive = JSON.parse(await fixture("export-v2.json"));
    await call("POST", "/api/import", archive);
    const before = await call("GET", "/api/export");
    const again = await call("POST", "/api/import", archive);
    expect(again.data).toMatchObject({
      created: 0,
      skipped: 2,
      failed: [],
      views: { created: 0, skipped: 1 },
      pins: { created: 0, skipped: 2 },
      hook_selections: { created: 0, skipped: 1 },
    });
    const after = await call("GET", "/api/export");
    expect({ ...after.data, exported_at: 0 }).toEqual({ ...before.data, exported_at: 0 });
  });

  test("a note that exists is left as it is, and nothing is pinned for it", async () => {
    const { call } = await boot();
    await call("POST", "/api/notes", { id: "archive-note-0002", body: "mine, edited here" });
    const result = await call("POST", "/api/import", JSON.parse(await fixture("export-v2.json")));
    expect(result.data).toMatchObject({ created: 1, skipped: 1, pins: { created: 1, skipped: 1 } });
    expect((await call("GET", "/api/notes/archive-note-0002")).data.body).toBe("mine, edited here");
    expect((await call("GET", "/api/pins")).data.map((n: Note) => n.id)).toEqual([
      "archive-note-0001",
    ]);
  });

  test("an archive from a newer version is refused whole, naming the newest this reads", async () => {
    const { call } = await boot();
    const archive = JSON.parse(await fixture("export-v2.json"));
    const res = await call("POST", "/api/import", { ...archive, version: ARCHIVE_VERSION + 1 });
    expect(res.status).toBe(422);
    expect(res.data.error).toBe("unsupportedFormat");
    expect(res.data.message).toContain(`up to version ${ARCHIVE_VERSION}`);
    expect((await call("GET", "/api/notes")).data).toEqual([]);
  });

  test.each([
    ["JSON that is not an archive", { hello: "world" }],
    ["a string", "just text"],
  ])("refuses %s as invalidImport", async (_, body) => {
    const { call } = await boot();
    const res = await call(
      "POST",
      "/api/import",
      typeof body === "string" ? JSON.stringify(body) : body,
      typeof body === "string" ? { "content-type": "application/json" } : {},
    );
    expect([res.status, res.data.error]).toEqual([400, "invalidImport"]);
  });

  test("text that is not JSON is invalidJson", async () => {
    const { call } = await boot();
    const res = await call("POST", "/api/import", "{nope", { "content-type": "application/json" });
    expect([res.status, res.data.error]).toEqual([400, "invalidJson"]);
  });

  test("a bad note fails alone, named by its position, and the rest import", async () => {
    const { call } = await boot();
    const res = await call("POST", "/api/import", [
      { id: "fine-note-0001", body: "ok" },
      { id: "x", body: "bad id" },
      { id: "fine-note-0003", body: "also ok" },
    ]);
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ created: 2, skipped: 0 });
    expect(res.data.failed).toMatchObject([
      { item: "note 2", message: expect.stringContaining("id must be") },
    ]);
  });

  test("a note with a revision that has no real date fails alone", async () => {
    const { call } = await boot();
    const res = await call("POST", "/api/import", [
      {
        id: "dated-note-0001",
        body: "x",
        revisions: [
          { title: "t", body: "x", tags: [], kind: "note", author: "a", updated_at: "nope" },
        ],
      },
    ]);
    expect(res.data.failed).toMatchObject([{ item: "note 1" }]);
  });

  test("pins past the limit are reported, not fatal", async () => {
    const { call } = await boot();
    const notes = Array.from({ length: MAX_PINS + 1 }, (_, i) => ({
      id: `pinned-note-${i}000`,
      body: `n${i}`,
    }));
    const res = await call("POST", "/api/import", {
      format: "pad-export",
      version: ARCHIVE_VERSION,
      notes,
      pins: notes.map((n) => ({ note_id: n.id })),
    });
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ created: MAX_PINS + 1, pins: { created: MAX_PINS } });
    expect(res.data.failed).toMatchObject([
      { item: `pin pinned-note-${MAX_PINS}000`, message: expect.stringContaining("pinned") },
    ]);
  });

  test("a hook selection for a hook this server does not have fails alone", async () => {
    const { call } = await boot();
    const archive = JSON.parse(await fixture("export-v2.json"));
    archive.hook_selections.push({ ...archive.hook_selections[0], hook: "from-the-future" });
    const res = await call("POST", "/api/import", archive);
    expect(res.data.hook_selections.created).toBe(1);
    expect(res.data.failed).toMatchObject([{ item: "hook selection from-the-future" }]);
  });

  test("a body over the operator's limit is payloadTooLarge, and nothing is imported", async () => {
    const { call } = await boot({ maxImportBytes: 200 });
    const res = await call("POST", "/api/import", [
      { id: "large-note-0001", body: "x".repeat(500) },
    ]);
    expect([res.status, res.data.error]).toEqual([413, "payloadTooLarge"]);
    expect(res.data.message).toContain("200");
    expect((await call("GET", "/api/notes")).data).toEqual([]);
  });

  test("needs the token", async () => {
    const { call } = await boot({ token: "secret" });
    expect((await call("POST", "/api/import", [{ body: "x" }])).status).toBe(401);
  });

  test("an import writes as the author it names, or as the sender when it names none", async () => {
    const { call } = await boot();
    await call(
      "POST",
      "/api/import",
      [
        { id: "named-note-0001", body: "a", author: "someone-else" },
        { id: "plain-note-0001", body: "b" },
      ],
      { "x-pad-author": "importer" },
    );
    expect((await call("GET", "/api/notes/named-note-0001")).data.author).toBe("someone-else");
    expect((await call("GET", "/api/notes/plain-note-0001")).data.author).toBe("importer");
  });
});

describe("GET /api/import", () => {
  test("tells a client the formats it reads and the most it may send", async () => {
    const { call } = await boot({ maxImportBytes: 1234 });
    expect((await call("GET", "/api/import")).data).toEqual({
      formats: [1, ARCHIVE_VERSION],
      max_bytes: 1234,
    });
  });
});

describe("the contract", () => {
  test("OpenAPI documents the archive, both endpoints and the new errors; llms.txt points agents to them", async () => {
    const { call } = await boot();
    const spec = (await call("GET", "/openapi.json")).data;
    expect(Object.keys(spec.paths["/api/export"])).toEqual(["get"]);
    expect(Object.keys(spec.paths["/api/import"]).sort()).toEqual(["get", "post"]);
    expect(spec.paths["/api/export"].get.parameters.map((p: { name: string }) => p.name)).toEqual(
      expect.arrayContaining(["q", "kind", "author", "tag", "history"]),
    );
    expect(spec.components.schemas.ExportArchive.properties.version.const).toBe(ARCHIVE_VERSION);
    expect(spec.components.schemas.ImportResult).toBeDefined();
    expect(spec.components.schemas.Error.properties.error.enum).toEqual(
      expect.arrayContaining(["payloadTooLarge", "unsupportedFormat", "invalidImport"]),
    );
    // Import takes the author an archive names, so it can attribute a note to anyone.
    expect(spec.paths["/api/import"].post.description).toContain("any author");
    const llms = (await call("GET", "/llms.txt")).data as string;
    expect(llms).toContain("/api/export");
    expect(llms).toContain("/api/import");
  });
});
