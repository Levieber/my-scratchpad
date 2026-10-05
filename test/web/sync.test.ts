import { describe, expect, test } from "bun:test";

import { fakeServer, fields, memoryStorage } from "@test/web/fake-server";

import { baseOf, Outbox } from "@/web/lib/outbox";
import { mergeFields, type Outcome, Syncer } from "@/web/lib/sync";

function setup() {
  const server = fakeServer();
  const outbox = new Outbox(memoryStorage());
  const syncer = new Syncer(outbox, server.remote);
  const outcomes: Outcome[] = [];
  syncer.onSettled((o) => void outcomes.push(o));
  return { server, outbox, syncer, outcomes };
}

describe("Outbox", () => {
  test("survives a reload", () => {
    const storage = memoryStorage();
    new Outbox(storage).save("n1", fields({ body: "typed offline" }), null);
    expect(new Outbox(storage).get("n1")).toMatchObject({
      op: "save",
      fields: { body: "typed offline" },
    });
  });

  test("a later edit replaces the content but keeps the base it started from", () => {
    const outbox = new Outbox(null);
    const base = { ...fields({ body: "v1" }), updated_at: "t1" };
    outbox.save("n1", fields({ body: "v2" }), base);
    outbox.save("n1", fields({ body: "v3" }), { ...base, updated_at: "t2" });
    expect(outbox.get("n1")).toMatchObject({ fields: { body: "v3" }, base: { updated_at: "t1" } });
  });
});

describe("Syncer", () => {
  test("a note made offline is created with its own id once back online", async () => {
    const { server, outbox, syncer } = setup();
    server.state.offline = true;
    outbox.save("offline-1", fields({ body: "made on the train" }), null);
    outbox.save("offline-1", fields({ body: "made on the train, edited" }), null);
    expect(await syncer.run()).toEqual({ status: "offline" });
    expect(outbox.all()).toHaveLength(1);

    server.state.offline = false;
    expect(await syncer.run()).toEqual({ status: "done" });
    expect(server.notes.get("offline-1")?.body).toBe("made on the train, edited");
    expect(server.state.calls).toEqual(["create"]);
    expect(outbox.all()).toEqual([]);
  });

  test("a create whose answer was lost is not made twice", async () => {
    const { server, outbox, syncer } = setup();
    await server.remote.create({ id: "dup-note", body: "first try" });
    outbox.save("dup-note", fields({ body: "retry, newer" }), null);
    await syncer.run();
    expect(server.notes.size).toBe(1);
    expect(server.notes.get("dup-note")?.body).toBe("retry, newer");
  });

  test("an edit made offline merges with an agent's append instead of overwriting it", async () => {
    const { server, outbox, syncer, outcomes } = setup();
    const note = await server.remote.create({ id: "log-note", body: "# Log\n- step 1" });
    server.state.offline = true;
    outbox.save("log-note", fields({ body: "# Build log\n- step 1" }), baseOf(note));
    server.edit("log-note", { body: "# Log\n- step 1\n- step 2 (agent)" });

    server.state.offline = false;
    await syncer.run();
    expect(server.notes.get("log-note")?.body).toBe("# Build log\n- step 1\n- step 2 (agent)");
    expect(outcomes.at(-1)).toMatchObject({ merged: true, conflict: false });
  });

  test("edits to the same line keep both, marked as a conflict", async () => {
    const { server, outbox, syncer, outcomes } = setup();
    const note = await server.remote.create({ id: "same-line", body: "status: draft" });
    outbox.save("same-line", fields({ body: "status: done" }), baseOf(note));
    server.edit("same-line", { body: "status: blocked" });
    await syncer.run();
    expect(server.notes.get("same-line")?.body).toContain("status: done\n=======\nstatus: blocked");
    expect(outcomes.at(-1)?.conflict).toBe(true);
  });

  test("a note deleted elsewhere while edited here comes back", async () => {
    const { server, outbox, syncer } = setup();
    const note = await server.remote.create({ id: "gone-note", body: "v1" });
    outbox.save("gone-note", fields({ body: "v2" }), baseOf(note));
    await server.remote.delete("gone-note");
    await syncer.run();
    expect(server.notes.get("gone-note")?.body).toBe("v2");
  });

  test("deletes are queued too, and a note already gone is fine", async () => {
    const { server, outbox, syncer } = setup();
    await server.remote.create({ id: "del-note1", body: "x" });
    outbox.delete("del-note1");
    outbox.delete("never-existed");
    expect(await syncer.run()).toEqual({ status: "done" });
    expect(server.notes.size).toBe(0);
  });

  test("a new note cleared before it synced is never created", async () => {
    const { server, outbox, syncer } = setup();
    outbox.save("empty-note", fields({ body: "" }), null);
    await syncer.run();
    expect(server.state.calls).toEqual([]);
    expect(outbox.all()).toEqual([]);
  });

  test("an edit typed while the previous one was in flight is based on the server's answer", async () => {
    const { server, outbox, syncer } = setup();
    const note = await server.remote.create({ id: "busy-note", body: "a" });
    outbox.save("busy-note", fields({ body: "a\nb" }), baseOf(note));
    const update = server.remote.update;
    let typed = false;
    server.remote.update = async (...args) => {
      const result = await update(...args);
      // The person keeps typing while the request is out.
      if (!typed) {
        typed = true;
        outbox.save("busy-note", fields({ body: "a\nb\nc" }), null);
      }
      return result;
    };
    await syncer.run();
    await syncer.run();
    expect(server.notes.get("busy-note")?.body).toBe("a\nb\nc");
    expect(outbox.all()).toEqual([]);
  });

  test("after a merge, an edit typed meanwhile is merged again rather than dropping theirs", async () => {
    const { server, outbox, syncer } = setup();
    const note = await server.remote.create({ id: "race-note", body: "one\ntwo" });
    outbox.save("race-note", fields({ body: "ONE\ntwo" }), baseOf(note));
    server.edit("race-note", { body: "one\ntwo\nthree (agent)" });
    const update = server.remote.update;
    let typed = false;
    server.remote.update = async (...args) => {
      const result = await update(...args);
      if (!typed) {
        typed = true;
        outbox.save("race-note", fields({ body: "ONE\ntwo!" }), null);
      }
      return result;
    };
    await syncer.run();
    await syncer.run();
    expect(server.notes.get("race-note")?.body).toBe("ONE\ntwo!\nthree (agent)");
  });

  test("only one run at a time; a run asked for during one follows it", async () => {
    const { server, outbox, syncer } = setup();
    outbox.save("first-note", fields({ body: "1" }), null);
    const a = syncer.run();
    outbox.save("second-note", fields({ body: "2" }), null);
    const b = syncer.run();
    expect(a).toBe(b);
    await a;
    expect([...server.notes.keys()].sort()).toEqual(["first-note", "second-note"]);
  });
});

describe("Syncer and pages", () => {
  test("a move is sent; an edit that didn't move the note doesn't send its parent", async () => {
    const { server, outbox, syncer } = setup();
    const page = await server.remote.create({ id: "page-0001", ...fields({ body: "page" }) });
    const note = await server.remote.create({ id: "note-0001", ...fields({ body: "note" }) });
    server.sent.length = 0;
    outbox.save(note.id, { ...fields({ body: "note" }), parent_id: page.id }, baseOf(note));
    await syncer.run();
    const moved = server.notes.get(note.id)!;
    outbox.save(
      note.id,
      { ...fields({ body: "note, edited" }), parent_id: page.id },
      baseOf(moved),
    );
    await syncer.run();
    expect(server.sent).toEqual([
      expect.objectContaining({ parent_id: page.id }),
      expect.not.objectContaining({ parent_id: expect.anything() }),
    ]);
  });

  test("an edit to a note whose page was deleted meanwhile still saves", async () => {
    const { server, outbox, syncer } = setup();
    const page = await server.remote.create({ id: "page-0002", ...fields({ body: "page" }) });
    const note = await server.remote.create({
      id: "note-0002",
      ...fields({ body: "under" }),
      parent_id: page.id,
    });
    outbox.save(
      note.id,
      { ...fields({ body: "under, edited" }), parent_id: page.id },
      baseOf(note),
    );
    server.notes.delete(page.id);
    expect(await syncer.run()).toEqual({ status: "done" });
    expect(server.notes.get(note.id)?.body).toBe("under, edited");
  });

  test("a subpage made offline under a page deleted before it synced lands at the top", async () => {
    const { server, outbox, syncer } = setup();
    outbox.save("sub-00001", { ...fields({ body: "subpage" }), parent_id: "gone-0001" }, null);
    expect(await syncer.run()).toEqual({ status: "done" });
    expect(server.notes.get("sub-00001")).toMatchObject({ body: "subpage", parent_id: null });
  });
});

describe("mergeFields", () => {
  test("the side that changed a field wins it", () => {
    const base = fields({ title: "T", tags: ["a"], body: "x" });
    const { fields: merged } = mergeFields(
      base,
      { ...base, title: "Mine" },
      { ...base, tags: ["a", "b"] },
    );
    expect(merged).toEqual(fields({ title: "Mine", tags: ["a", "b"], body: "x" }));
  });
});
