import { describe, expect, test } from "bun:test";

import { REVISION_WINDOW_MS, Store } from "../src/db";

// A store whose clock the test moves by hand.
function clockedStore() {
  let t = Date.parse("2026-09-29T10:00:00.000Z");
  const store = new Store(":memory:", { now: () => new Date(t) });
  return { store, advance: (ms: number) => (t += ms) };
}

describe("revisions", () => {
  test("saves by one author within the window are one revision; later ones start another", () => {
    const { store, advance } = clockedStore();
    const n = store.create({ body: "a" });
    advance(60_000);
    store.update(n.id, { body: "a\nb" });
    expect(store.revisions(n.id).map((r) => r.added)).toEqual([2]);

    advance(REVISION_WINDOW_MS);
    store.update(n.id, { body: "a\nb\nc" });
    expect(store.revisions(n.id).map((r) => [r.added, r.removed])).toEqual([
      [1, 0],
      [2, 0],
    ]);
  });

  test("another author's save starts a revision even inside the window", () => {
    const { store } = clockedStore();
    const n = store.create({ body: "a" });
    store.append(n.id, "b", "claude-code");
    store.update(n.id, { body: "a\nb\nc" });
    expect(store.revisions(n.id).map((r) => r.author)).toEqual(["human", "claude-code", "human"]);
  });

  test("an edit typed and undone within the window leaves no revision", () => {
    const { store, advance } = clockedStore();
    const n = store.create({ body: "a" });
    advance(REVISION_WINDOW_MS);
    store.update(n.id, { body: "a!" });
    store.update(n.id, { body: "a" });
    expect(store.revisions(n.id)).toHaveLength(1);
  });

  test("revisions record title, tags and kind; a folded revision recounts against the one before", () => {
    const { store, advance } = clockedStore();
    const n = store.create({ body: "x\ny" });
    advance(REVISION_WINDOW_MS);
    store.update(n.id, { body: "x\nY", tags: ["A"] });
    store.update(n.id, { body: "x\nY\nz", kind: "reference" });
    const [latest] = store.revisions(n.id);
    expect(latest).toMatchObject({
      added: 2,
      removed: 1,
      tags: ["a"],
      kind: "reference",
      title: "x",
    });
    expect(store.latestRevision(n.id)?.body).toBe("x\nY\nz");
  });

  test("latestRevision(until) finds the note as it was at a time", () => {
    const { store, advance } = clockedStore();
    const n = store.create({ body: "v1" });
    const t1 = store.get(n.id)!.updated_at;
    advance(REVISION_WINDOW_MS);
    store.update(n.id, { body: "v2" });
    expect(store.latestRevision(n.id, t1)?.body).toBe("v1");
    expect(store.latestRevision(n.id, "2000-01-01T00:00:00.000Z")).toBeNull();
  });
});
