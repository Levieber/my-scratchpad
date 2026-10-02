import { afterEach, describe, expect, test } from "bun:test";

import { Client } from "../src/client";
import { Store } from "../src/db";
import { createServer } from "../src/server";
import { exportNotes, importNotes, parseExport } from "../src/transfer";

let server: ReturnType<typeof createServer> | undefined;

function boot() {
  server = createServer({ store: new Store(":memory:") });
  return new Client(server.url.origin, "tester", undefined);
}

afterEach(async () => {
  await server?.stop(true);
  server = undefined;
});

describe("export and import", () => {
  test("a note survives a round trip into another server with its id, tags and kind", async () => {
    const source = boot();
    const a = await source.create({
      title: "Rules",
      body: "- [ ] one",
      tags: ["x"],
      kind: "reference",
    });
    await source.create({ body: "plain" });
    const file = JSON.stringify(await exportNotes(source));
    await server?.stop(true);

    const target = boot();
    const result = await importNotes(target, parseExport(file));
    expect(result).toEqual({ created: 2, skipped: 0, failed: [] });
    const copy = await target.get(a.id);
    expect([copy.title, copy.body, copy.tags, copy.kind]).toEqual([
      "Rules",
      "- [ ] one",
      ["x"],
      "reference",
    ]);
  });

  test("importing the same file twice skips what exists", async () => {
    const client = boot();
    await client.create({ body: "once" });
    const inputs = parseExport(JSON.stringify(await exportNotes(client)));
    expect(await importNotes(client, inputs)).toEqual({ created: 0, skipped: 1, failed: [] });
    expect(await client.list()).toHaveLength(1);
  });

  test("export follows the filters and reads past one page", async () => {
    const client = boot();
    for (let i = 0; i < 501; i++)
      await client.create({ body: `n${i}`, tags: i === 0 ? ["a"] : [] });
    expect(await exportNotes(client)).toHaveLength(501);
    expect(await exportNotes(client, { tag: ["a"] })).toHaveLength(1);
  });

  test("a note the API rejects fails alone and is reported by position", async () => {
    const client = boot();
    const result = await importNotes(client, [{ body: "ok" }, {}, { body: "also ok" }]);
    expect([result.created, result.failed.map((f) => f.item)]).toEqual([2, [2]]);
  });
});

describe("parseExport", () => {
  test("rejects what is not a list of notes, naming the item", () => {
    expect(() => parseExport("nope")).toThrow("Not valid JSON");
    expect(() => parseExport("{}")).toThrow("array");
    expect(() => parseExport('[{"body":"x"},3]')).toThrow("Item 2");
    expect(() => parseExport('[{"id":"a/b"}]')).toThrow("Item 1: invalid id");
    expect(() => parseExport('[{"kind":"memo"}]')).toThrow("unknown kind");
  });

  test("keeps only the fields the API accepts", () => {
    expect(parseExport('[{"title":"t","author":"agent","progress":{"done":1,"total":2}}]')).toEqual(
      [{ id: undefined, title: "t", body: undefined, tags: undefined, kind: undefined }],
    );
  });
});
