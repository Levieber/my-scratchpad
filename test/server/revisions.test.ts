import { afterEach, describe, expect, test } from "bun:test";

import { testStore } from "@test/support";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { REVISION_WINDOW_MS } from "@/server/storage/revisions";
import { Store } from "@/server/storage/store";

let fixture: Awaited<ReturnType<typeof testStore>> | undefined;

// A store whose clock the test moves by hand.
async function clockedStore() {
  fixture = await testStore();
  const { run, advance } = fixture;
  const store = <A, E>(f: (store: Store["Service"]) => Effect.Effect<A, E>) =>
    run(Effect.flatMap(Store, f));
  return { store, advance };
}

afterEach(async () => {
  await fixture?.dispose();
  fixture = undefined;
});

const authors = (revs: { author: string }[]) => revs.map((r) => r.author);

describe("revisions", () => {
  test("saves by one author within the window are one revision; later ones start another", async () => {
    const { store, advance } = await clockedStore();
    const n = await store((s) => s.create({ body: "a" }));
    await advance(60_000);
    await store((s) => s.update(n.id, { body: "a\nb" }));
    expect((await store((s) => s.revisions(n.id))).map((r) => r.added)).toEqual([2]);

    await advance(REVISION_WINDOW_MS);
    await store((s) => s.update(n.id, { body: "a\nb\nc" }));
    expect((await store((s) => s.revisions(n.id))).map((r) => [r.added, r.removed])).toEqual([
      [1, 0],
      [2, 0],
    ]);
  });

  test("another author's save starts a revision even inside the window", async () => {
    const { store } = await clockedStore();
    const n = await store((s) => s.create({ body: "a" }));
    await store((s) => s.append(n.id, "b", "claude-code"));
    await store((s) => s.update(n.id, { body: "a\nb\nc" }));
    expect(authors(await store((s) => s.revisions(n.id)))).toEqual([
      "human",
      "claude-code",
      "human",
    ]);
  });

  test("an edit typed and undone within the window leaves no revision", async () => {
    const { store, advance } = await clockedStore();
    const n = await store((s) => s.create({ body: "a" }));
    await advance(REVISION_WINDOW_MS);
    await store((s) => s.update(n.id, { body: "a!" }));
    await store((s) => s.update(n.id, { body: "a" }));
    expect(await store((s) => s.revisions(n.id))).toHaveLength(1);
  });

  test("revisions record title, tags and kind; a folded revision recounts against the one before", async () => {
    const { store, advance } = await clockedStore();
    const n = await store((s) => s.create({ body: "x\ny" }));
    await advance(REVISION_WINDOW_MS);
    await store((s) => s.update(n.id, { body: "x\nY", tags: ["A"] }));
    await store((s) => s.update(n.id, { body: "x\nY\nz", kind: "reference" }));
    const [latest] = await store((s) => s.revisions(n.id));
    expect(latest).toMatchObject({
      added: 2,
      removed: 1,
      tags: ["a"],
      kind: "reference",
      title: "x",
    });
    const body = await store((s) => s.latestRevision(n.id));
    expect(Option.map(body, (r) => r.body)).toEqual(Option.some("x\nY\nz"));
  });

  test("latestRevision(until) finds the note as it was at a time", async () => {
    const { store, advance } = await clockedStore();
    const n = await store((s) => s.create({ body: "v1" }));
    const t1 = (await store((s) => s.get(n.id))).updated_at;
    await advance(REVISION_WINDOW_MS);
    await store((s) => s.update(n.id, { body: "v2" }));
    const then = await store((s) => s.latestRevision(n.id, t1));
    expect(Option.map(then, (r) => r.body)).toEqual(Option.some("v1"));
    expect(await store((s) => s.latestRevision(n.id, "2000-01-01T00:00:00.000Z"))).toEqual(
      Option.none(),
    );
  });

  test("the clock the store reads is the one the test moves", async () => {
    const { store, advance } = await clockedStore();
    await advance(1000);
    const n = await store((s) => s.create({ body: "x" }));
    expect(n.created_at).toBe("2026-09-29T10:00:01.000Z");
  });
});
