import { afterEach, describe, expect, test } from "bun:test";

import * as Effect from "effect/Effect";

import { Client } from "@/client";
import { exportNotes, importNotes, parseExport } from "@/transfer";

import { type TestServer, testServer } from "./support";

let server: TestServer | undefined;

// A fresh server, and a way to run client effects against it.
async function boot() {
  server = await testServer();
  const layer = Client.layerWith({ url: server.url.origin, author: "tester" });
  return <A, E>(effect: Effect.Effect<A, E, Client>) =>
    Effect.runPromise(Effect.provide(effect, layer));
}

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

const client = Effect.service(Client);
const parse = (text: string) => Effect.runPromise(parseExport(text));
const parseError = (text: string) =>
  Effect.runPromise(Effect.flip(parseExport(text))).then((e) => e.message);

describe("export and import", () => {
  test("a note survives a round trip into another server with its id, tags and kind", async () => {
    const source = await boot();
    const a = await source(
      Effect.flatMap(client, (c) =>
        c.create({ title: "Rules", body: "- [ ] one", tags: ["x"], kind: "reference" }),
      ),
    );
    await source(Effect.flatMap(client, (c) => c.create({ body: "plain" })));
    const file = JSON.stringify(await source(exportNotes()));
    await server?.stop();

    const target = await boot();
    const result = await target(importNotes(await parse(file)));
    expect(result).toEqual({ created: 2, skipped: 0, failed: [] });
    const copy = await target(Effect.flatMap(client, (c) => c.get(a.id)));
    expect([copy.title, copy.body, copy.tags, copy.kind]).toEqual([
      "Rules",
      "- [ ] one",
      ["x"],
      "reference",
    ]);
  });

  test("importing the same file twice skips what exists", async () => {
    const run = await boot();
    await run(Effect.flatMap(client, (c) => c.create({ body: "once" })));
    const inputs = await parse(JSON.stringify(await run(exportNotes())));
    expect(await run(importNotes(inputs))).toEqual({ created: 0, skipped: 1, failed: [] });
    expect(await run(Effect.flatMap(client, (c) => c.list()))).toHaveLength(1);
  });

  test("export follows the filters and reads past one page", async () => {
    const run = await boot();
    await run(
      Effect.flatMap(client, (c) =>
        Effect.forEach(
          Array.from({ length: 501 }, (_, i) => i),
          (i) => c.create({ body: `n${i}`, tags: i === 0 ? ["a"] : [] }),
        ),
      ),
    );
    expect(await run(exportNotes())).toHaveLength(501);
    expect(await run(exportNotes({ tag: ["a"] }))).toHaveLength(1);
  });

  test("a note the API rejects fails alone and is reported by position", async () => {
    const run = await boot();
    const result = await run(importNotes([{ body: "ok" }, {}, { body: "also ok" }]));
    expect([result.created, result.failed.map((f) => f.item)]).toEqual([2, [2]]);
  });
});

describe("parseExport", () => {
  test("rejects what is not a list of notes, naming the item", async () => {
    expect(await parseError("nope")).toContain("Not valid JSON");
    expect(await parseError("{}")).toContain("array");
    expect(await parseError('[{"body":"x"},3]')).toContain("Item 2");
    expect(await parseError('[{"id":"a/b"}]')).toContain("Item 1: invalid id");
    expect(await parseError('[{"kind":"memo"}]')).toContain("unknown kind");
    expect(await parseError('[{"tags":[1]}]')).toBe("Item 1: tags must be an array of strings.");
  });

  test("keeps only the fields the API accepts", async () => {
    expect(await parse('[{"title":"t","author":"agent","progress":{"done":1,"total":2}}]')).toEqual(
      [{ title: "t" }],
    );
  });
});
