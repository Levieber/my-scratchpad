import { afterEach, describe, expect, test } from "bun:test";

import { type TestServer, testServer } from "@test/support";
import * as Effect from "effect/Effect";

import { Client } from "@/client/client";
import { exportNotes, importFile } from "@/client/transfer";
import { ARCHIVE_VERSION, type ExportArchive } from "@/shared/archive";
import type { Note, Revision } from "@/shared/domain";

const servers: TestServer[] = [];
const stand: { stop: () => void }[] = [];

afterEach(async () => {
  for (const s of stand.splice(0)) s.stop();
  await Promise.all(servers.splice(0).map((s) => s.stop()));
});

type Run = <A, E>(effect: Effect.Effect<A, E, Client>) => Promise<A>;

const runner = (origin: string, author = "tester"): Run => {
  const layer = Client.layerWith({ url: origin, author });
  return (effect) => Effect.runPromise(Effect.provide(effect, layer));
};

/** A fresh server, and a way to run client effects against it. */
async function boot() {
  const server = await testServer();
  servers.push(server);
  return runner(server.url.origin);
}

/**
 * A server from before archives: it answers everything as `server` does, except that it has never
 * heard of /api/export and /api/import.
 */
async function bootOlder() {
  const real = await testServer();
  servers.push(real);
  const older = Bun.serve({
    port: 0,
    fetch: (req) => {
      const url = new URL(req.url);
      if (/^\/api\/(export|import)/.test(url.pathname))
        return Response.json({ error: "notFound", message: "No such endpoint" }, { status: 404 });
      return fetch(new URL(url.pathname + url.search, real.url), req);
    },
  });
  stand.push({ stop: () => void older.stop(true) });
  return runner(older.url.origin);
}

const client = Effect.service(Client);
const create = (input: Parameters<Client["Service"]["create"]>[0]) =>
  Effect.flatMap(client, (c) => c.create(input));

describe("export and import through the archive", () => {
  test("a note, its history and its pin survive a round trip into another server", async () => {
    const source = await boot();
    const a = await source(create({ id: "rt-note-0001", title: "Rules", body: "v1", tags: ["x"] }));
    // By another author, so it is a revision of its own and not folded into the first.
    const agent = runner(servers[0]!.url.origin, "claude-code");
    await agent(Effect.flatMap(client, (c) => c.update(a.id, { body: "v2" })));
    await source(Effect.flatMap(client, (c) => c.pin(a.id)));

    const exported = await source(exportNotes());
    expect(exported).toMatchObject({ notes: 1, history: true, fallback: false });
    const file = JSON.stringify(exported.data);

    const target = await boot();
    const { result, fallback } = await target(importFile(file));
    expect(fallback).toBe(false);
    expect(result).toMatchObject({ created: 1, skipped: 0, failed: [], pins: { created: 1 } });
    const copy = await target(Effect.flatMap(client, (c) => c.get(a.id)));
    expect([copy.title, copy.body, copy.tags]).toEqual(["Rules", "v2", ["x"]]);
    expect(copy.author).toBe(a.author);
    const history = await target(Effect.flatMap(client, (c) => c.revisions(a.id)));
    expect(history.map((r: Revision) => [r.author, r.added, r.removed])).toEqual([
      ["claude-code", 1, 1],
      ["tester", 1, 0],
    ]);
    expect(await target(Effect.flatMap(client, (c) => c.pins()))).toHaveLength(1);
  });

  test("importing the same file twice skips what exists", async () => {
    const run = await boot();
    await run(create({ body: "once" }));
    const file = JSON.stringify((await run(exportNotes())).data);
    const { result } = await run(importFile(file));
    expect(result).toMatchObject({ created: 0, skipped: 1, failed: [] });
    expect(await run(Effect.flatMap(client, (c) => c.list()))).toHaveLength(1);
  });

  test("history can be left out, and the filters pick the notes", async () => {
    const run = await boot();
    await run(create({ body: "n0", tags: ["a"] }));
    await run(create({ body: "n1" }));
    const bare = await run(exportNotes({ tag: ["a"] }, { history: false }));
    const archive = bare.data as ExportArchive;
    expect([bare.notes, bare.history, archive.version]).toEqual([1, false, ARCHIVE_VERSION]);
    expect(archive.notes[0]).not.toHaveProperty("revisions");
  });

  test("a file that is not JSON, or not an archive, is a 400 with a sentence", async () => {
    const run = await boot();
    expect(await run(Effect.flip(importFile("{nope")))).toMatchObject({ status: 400 });
    expect(await run(Effect.flip(importFile('{"hello":1}')))).toMatchObject({
      status: 400,
      code: "invalidImport",
    });
  });

  test("an archive from a newer version is refused by the server, naming what it reads", async () => {
    const run = await boot();
    const file = JSON.stringify({
      format: "pad-export",
      version: ARCHIVE_VERSION + 1,
      notes: [],
    });
    const error = await run(Effect.flip(importFile(file)));
    expect([error.status, error.code]).toEqual([422, "unsupportedFormat"]);
    expect(error.message).toContain(`up to version ${ARCHIVE_VERSION}`);
  });

  test("a note the server rejects fails alone and is reported", async () => {
    const run = await boot();
    const { result } = await run(
      importFile(JSON.stringify([{ body: "ok" }, { id: "x", body: "bad" }, { body: "fine" }])),
    );
    expect(result.created).toBe(2);
    expect(result.failed).toMatchObject([{ item: "note 2" }]);
  });
});

describe("against a server from before archives", () => {
  test("export falls back to the notes alone, as the bare array version 1 files are", async () => {
    const run = await bootOlder();
    await run(create({ id: "old-note-0001", body: "plain" }));
    const exported = await run(exportNotes());
    expect(exported).toMatchObject({ notes: 1, history: false, fallback: true });
    expect(Array.isArray(exported.data)).toBe(true);
    expect((exported.data as Note[])[0]?.id).toBe("old-note-0001");
  });

  test("export reads past one page", async () => {
    const run = await bootOlder();
    await run(
      Effect.flatMap(client, (c) =>
        Effect.forEach(
          Array.from({ length: 501 }, (_, i) => i),
          (i) => c.create({ body: `n${i}` }),
          { concurrency: 20 },
        ),
      ),
    );
    expect((await run(exportNotes({}, { history: false }))).notes).toBe(501);
  });

  test("import falls back to creating each note, keeping ids and skipping what exists", async () => {
    const run = await bootOlder();
    await run(create({ id: "old-note-0002", body: "mine" }));
    const file = JSON.stringify([
      { id: "old-note-0001", body: "a", tags: ["t"], kind: "reference", author: "someone" },
      { id: "old-note-0002", body: "theirs" },
      { id: "x", body: "bad id" },
    ]);
    const { result, fallback } = await run(importFile(file));
    expect(fallback).toBe(true);
    expect(result).toMatchObject({ created: 1, skipped: 1 });
    expect(result.failed).toMatchObject([{ item: "note 3" }]);
    const note = await run(Effect.flatMap(client, (c) => c.get("old-note-0001")));
    expect([note.body, note.tags, note.kind]).toEqual(["a", ["t"], "reference"]);
  });

  test("a file the fallback can't read is a 400 naming the problem", async () => {
    const run = await bootOlder();
    const error = await run(Effect.flip(importFile('{"hello":1}')));
    expect([error.status, error.code]).toEqual([400, "invalidImport"]);
  });
});
