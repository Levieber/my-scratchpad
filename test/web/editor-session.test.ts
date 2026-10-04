import { describe, expect, test } from "bun:test";

import { fakeServer, fields, memoryStorage } from "@test/web/fake-server";

import type { FullRevision, Note } from "@/shared/domain";
import { EditorSession } from "@/web/lib/editor-session";
import { baseOf, fieldsOf, Outbox } from "@/web/lib/outbox";
import { retag } from "@/web/lib/retag";
import { type SyncResult, Syncer } from "@/web/lib/sync";

function setup(initialMode: "read" | "write" = "read") {
  const server = fakeServer();
  const outbox = new Outbox(memoryStorage());
  const syncer = new Syncer(outbox, server.remote);
  const results: SyncResult[] = [];
  const chosen: string[] = [];
  let ids = 0;
  const session = new EditorSession({
    outbox,
    syncer,
    newId: () => `n${++ids}`,
    onSynced: (r) => void results.push(r),
    autosaveMs: 5,
    modes: { initial: () => initialMode, chosen: (m) => void chosen.push(m) },
  });
  /** A note the server already has, as the list would hand it over. */
  const seed = async (body: string) =>
    server.remote.create({ id: `s${++ids}`, ...fields({ body }) });
  return { server, outbox, session, results, chosen, seed, state: session.getSnapshot };
}

const settle = () => Bun.sleep(30);

describe("EditorSession", () => {
  test("an edit is saved once typing pauses, and the server's answer becomes the note", async () => {
    const { server, session, seed, state } = setup();
    const note = await seed("first");
    await session.open(async () => note);
    session.edit({ body: "first\nsecond" });
    expect(state().saveState).toBe("pending");
    await settle();
    expect(server.notes.get(note.id)?.body).toBe("first\nsecond");
    expect(state().saveState).toBe("saved");
    expect(state().current?.updated_at).toBe(server.notes.get(note.id)!.updated_at);
  });

  test("commit queues the edit synchronously, as beforeunload needs", async () => {
    const { outbox, session, seed } = setup();
    const note = await seed("draft");
    await session.open(async () => note);
    session.edit({ body: "draft, longer" });
    session.commit();
    expect(outbox.get(note.id)).toMatchObject({ op: "save", fields: { body: "draft, longer" } });
  });

  test("a new note gets its id when first queued; one left empty is never queued", async () => {
    const { outbox, session, server, state } = setup();
    session.create();
    session.edit({ body: "  " });
    session.commit();
    expect(outbox.all()).toEqual([]);
    expect(state().current).toBeNull();

    session.edit({ body: "hello" });
    session.commit();
    const id = state().current!.id;
    expect(outbox.get(id)).toMatchObject({ op: "save", base: null });
    await session.sync();
    expect(server.notes.get(id)?.body).toBe("hello");
  });

  test("offline, the edit stays on this device and says so", async () => {
    const { server, session, seed, state, results } = setup();
    const note = await seed("a");
    await session.open(async () => note);
    server.state.offline = true;
    session.edit({ body: "b" });
    await settle();
    expect(state().saveState).toBe("local");
    expect(results.at(-1)).toEqual({ status: "offline" });

    server.state.offline = false;
    await session.sync();
    expect(state().saveState).toBe("saved");
    expect(server.notes.get(note.id)?.body).toBe("b");
  });

  test("a write elsewhere meanwhile is merged into the editor", async () => {
    const { server, session, seed, state } = setup();
    const note = await seed("one\ntwo\n");
    await session.open(async () => note);
    server.edit(note.id, { body: "zero\none\ntwo\n" });
    session.edit({ body: "one\ntwo\nthree\n" });
    await settle();
    expect(state().saveState).toBe("merged");
    expect(state().draft.body).toBe("zero\none\ntwo\nthree\n");
    expect(server.notes.get(note.id)?.body).toBe("zero\none\ntwo\nthree\n");
  });

  test("typing while a merged save is in flight is merged into its result", async () => {
    const { server, session, seed, state } = setup();
    const note = await seed("a\nb\nc\n");
    await session.open(async () => note);
    server.edit(note.id, { body: "top\na\nb\nc\n" });
    session.edit({ body: "a\nb\nc\nend\n" });
    session.commit();
    const sending = session.sync();
    session.edit({ body: "a\nB\nc\nend\n" });
    await sending;
    expect(state().draft.body).toBe("top\na\nB\nc\nend\n");
    expect(state().saveState).toBe("merged");
  });

  describe("receive", () => {
    test("a newer version from the server replaces the open note", async () => {
      const { server, session, seed, state } = setup();
      const note = await seed("old");
      await session.open(async () => note);
      server.edit(note.id, { body: "new" });
      session.receive(server.notes.get(note.id)!);
      expect(state().draft.body).toBe("new");
    });

    test("an answer older than what is shown is ignored", async () => {
      const { session, seed, state, server } = setup();
      const note = await seed("v1");
      await session.open(async () => note);
      session.edit({ body: "v2" });
      await settle();
      expect(server.notes.get(note.id)?.body).toBe("v2");
      session.receive(note);
      expect(state().draft.body).toBe("v2");
    });

    test("nothing replaces an edit not sent yet", async () => {
      const { server, session, seed, state } = setup();
      const note = await seed("mine");
      await session.open(async () => note);
      session.edit({ body: "mine, typing" });
      server.edit(note.id, { body: "theirs" });
      session.receive(server.notes.get(note.id)!);
      expect(state().draft.body).toBe("mine, typing");
      session.commit();
      session.receive(server.notes.get(note.id)!);
      expect(state().draft.body).toBe("mine, typing");
    });
  });

  test("an edit waiting in the outbox is what opening the note shows", async () => {
    const { server, outbox, session, seed, state } = setup();
    const note = await seed("server");
    outbox.save(note.id, fields({ body: "waiting" }), {
      ...fields({ body: "server" }),
      updated_at: note.updated_at,
    });
    server.state.offline = true;
    await session.open(async () => note);
    expect(state()).toMatchObject({ open: true, saveState: "local", draft: { body: "waiting" } });
  });

  test("removing the open note closes the editor and deletes it", async () => {
    const { server, session, seed, state } = setup();
    const note = await seed("bye");
    await session.open(async () => note);
    session.edit({ body: "bye!" });
    session.remove();
    expect(state().open).toBe(false);
    await settle();
    expect(server.notes.has(note.id)).toBe(false);
  });

  test("history opens on what was just saved; restoring edits the note back", async () => {
    const { server, session, seed, state } = setup();
    const note: Note = await seed("now");
    await session.open(async () => note);
    session.edit({ body: "now, edited" });
    await session.toggleHistory();
    expect(server.notes.get(note.id)?.body).toBe("now, edited");
    expect(state().showHistory).toBe(true);

    const revision = { ...note, body: "before" } as unknown as FullRevision;
    session.restore(revision);
    expect(state()).toMatchObject({ showHistory: false, draft: { body: "before" } });
    await settle();
    expect(server.notes.get(note.id)?.body).toBe("before");
  });

  test("the snapshot is the same object until something changes", async () => {
    const { session, state } = setup();
    const before = state();
    expect(state()).toBe(before);
    session.create("x");
    expect(state()).not.toBe(before);
  });

  describe("retag (a board's move)", () => {
    test("a note not open goes through the outbox, keeping an edit already waiting", async () => {
      const { server, outbox, session, seed } = setup();
      const note = await seed("body");
      outbox.save(note.id, { ...fieldsOf(note), body: "body, edited offline" }, baseOf(note));
      retag(session, outbox, note, ["status:done"]);
      expect(outbox.get(note.id)).toMatchObject({
        fields: { body: "body, edited offline", tags: ["status:done"] },
      });
      await settle();
      expect(server.notes.get(note.id)).toMatchObject({
        body: "body, edited offline",
        tags: ["status:done"],
      });
    });

    test("the open note changes through its form, so its next save keeps the new tags", async () => {
      const { server, outbox, session, seed, state } = setup();
      const note = await seed("open");
      await session.open(async () => note);
      retag(session, outbox, note, ["status:doing"]);
      expect(state().draft.tags).toBe("status:doing");
      session.edit({ body: "open, typed after" });
      await settle();
      expect(server.notes.get(note.id)).toMatchObject({
        body: "open, typed after",
        tags: ["status:doing"],
      });
    });
  });

  describe("Read and Write", () => {
    test("an existing note opens in Read, a new one in Write", async () => {
      const { session, seed, state } = setup();
      await session.open(async () => seed("- [ ] a"));
      expect(state().mode).toBe("read");
      session.create();
      expect(state().mode).toBe("write");
    });

    test("the choice is kept, and the next note opens as this device last chose", async () => {
      const { session, seed, state, chosen } = setup("write");
      await session.open(async () => seed("text"));
      expect(state().mode).toBe("write");
      session.setMode("read");
      expect([state().mode, chosen]).toEqual(["read", ["read"]]);
    });

    test("a tick is an edit like typing: queued in the outbox, saved, one line changed", async () => {
      const { server, session, seed } = setup();
      const note = await seed("- [ ] a\n- [ ] b");
      await session.open(async () => note);
      session.edit({ body: "- [ ] a\n- [x] b" });
      session.commit();
      await session.sync();
      expect(server.notes.get(note.id)?.body).toBe("- [ ] a\n- [x] b");
    });

    test("counts the times the body is replaced from outside, not typing", async () => {
      const { server, session, seed, state } = setup();
      const note = await seed("first");
      await session.open(async () => note);
      const before = state().external;
      session.edit({ body: "typed" });
      expect(state().external).toBe(before);
      await settle();
      server.edit(note.id, { body: "from an agent" });
      session.receive(server.notes.get(note.id)!);
      expect([state().draft.body, state().external]).toEqual(["from an agent", before + 1]);
    });
  });
});
