// Offline editing. Every edit waits in the outbox (kept in localStorage) until the server has it,
// so nothing typed is lost to a dropped connection, a closed tab, or someone else's write: an
// edit carries the version it started from, and if the note changed since, the two are merged.
// Kept apart from React so it can be tested directly.
import { progress } from "../checklist";
import { merge3 } from "../diff";
import type { Kind } from "../kinds";
import { deriveTitle } from "../title";
import { isApiError, Offline, Unauthorized, type Note, type NoteInput } from "./api";

/** What the editor changes. */
export type Fields = { title: string; body: string; tags: string[]; kind: Kind };

/** The server's version an edit started from: its content to merge against, its version for If-Match. */
export type Base = Fields & { updated_at: string };

export type Pending =
  /** `base` null: a note made here that the server hasn't seen yet. */
  | { op: "save"; id: string; seq: number; fields: Fields; base: Base | null }
  | { op: "delete"; id: string; seq: number };

export const fieldsOf = (n: Fields): Fields => ({
  title: n.title,
  body: n.body,
  tags: n.tags,
  kind: n.kind,
});
export const baseOf = (n: Note): Base => ({ ...fieldsOf(n), updated_at: n.updated_at });

// Never a note's updated_at, so a write sent with it is refused and goes through a merge.
const STALE = "stale";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

export class Outbox {
  private entries = new Map<string, Pending>();
  private seq = 0;
  private listeners = new Set<() => void>();

  constructor(
    private storage: Storage | null,
    private key = "pad-outbox",
  ) {
    try {
      for (const p of JSON.parse(storage?.getItem(key) ?? "[]") as Pending[]) {
        this.entries.set(p.id, p);
        this.seq = Math.max(this.seq, p.seq);
      }
    } catch {}
  }

  all = (): Pending[] => [...this.entries.values()];
  get = (id: string): Pending | undefined => this.entries.get(id);

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  /** Queues the editor's content. An edit already waiting keeps its base: it started from there. */
  save(id: string, fields: Fields, base: Base | null) {
    const prev = this.entries.get(id);
    const kept = prev?.op === "save" ? prev.base : base;
    this.set({ op: "save", id, seq: ++this.seq, fields, base: kept });
  }

  delete(id: string) {
    this.set({ op: "delete", id, seq: ++this.seq });
  }

  /**
   * After the server accepted `sent` (answering `note`): forget it, unless a newer edit came in
   * meanwhile. That edit was typed on top of `sent`, so the server's answer is its base now —
   * unless the server merged in someone else's changes, which the edit doesn't have: then the
   * next write must be refused and merged too.
   */
  settle(sent: Pending, note: Note | null, merged: boolean) {
    const cur = this.entries.get(sent.id);
    if (!cur) return;
    if (cur.seq === sent.seq) {
      this.entries.delete(sent.id);
      this.persist();
    } else if (cur.op === "save" && sent.op === "save" && note) {
      this.set({
        ...cur,
        base: merged ? { ...sent.fields, updated_at: STALE } : baseOf(note),
      });
    }
  }

  private set(p: Pending) {
    this.entries.set(p.id, p);
    this.persist();
  }

  private persist() {
    try {
      this.storage?.setItem(this.key, JSON.stringify(this.all()));
    } catch {}
    this.listeners.forEach((fn) => fn());
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Field by field, the side that changed wins; the body is merged line by line (src/diff.ts). */
export function mergeFields(
  base: Fields,
  mine: Fields,
  theirs: Fields,
): { fields: Fields; conflict: boolean } {
  const pick = <K extends keyof Fields>(k: K): Fields[K] =>
    same(mine[k], base[k]) ? theirs[k] : mine[k];
  const body = merge3(base.body, mine.body, theirs.body);
  return {
    fields: {
      title: pick("title"),
      body: body.text,
      tags: pick("tags"),
      kind: pick("kind"),
    },
    conflict: body.conflict,
  };
}

/** The subset of `api` that syncing uses; tests pass a fake. */
export type Remote = {
  create(input: NoteInput): Promise<Note>;
  update(id: string, patch: NoteInput, ifMatch?: string): Promise<Note>;
  get(id: string): Promise<Note>;
  delete(id: string): Promise<void>;
};

export type Outcome = {
  sent: Pending;
  /** The note as the server now has it; null after a delete, or a new note left empty. */
  note: Note | null;
  merged: boolean;
  /** The merge found edits to the same lines on both sides and kept both between markers. */
  conflict: boolean;
};

async function push(entry: Pending, remote: Remote): Promise<Outcome> {
  const done = (note: Note | null, merged = false, conflict = false): Outcome => ({
    sent: entry,
    note,
    merged,
    conflict,
  });

  if (entry.op === "delete") {
    await remote.delete(entry.id).catch((e) => {
      if (!isApiError(e, "noteNotFound")) throw e;
    });
    return done(null);
  }

  const { id, fields, base } = entry;
  if (!base) {
    // Started and cleared again before the server saw it: nothing to create.
    if (!fields.body.trim() && !fields.title.trim()) return done(null);
    try {
      return done(await remote.create({ id, ...fields }));
    } catch (e) {
      if (!isApiError(e, "noteExists")) throw e;
      // An earlier attempt got through but its answer was lost; this edit is newer.
      return done(await remote.update(id, fields));
    }
  }

  let write = fields;
  let version = base.updated_at;
  let merged = false;
  let conflict = false;
  // Each retry follows a write that landed between our read and our write; three in a row means
  // the note is busy, and the next sync tries again.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return done(await remote.update(id, write, version), merged, conflict);
    } catch (e) {
      // Deleted elsewhere while edited here: bring it back rather than lose the edit.
      if (isApiError(e, "noteNotFound")) return done(await remote.create({ id, ...fields }));
      if (!isApiError(e, "noteChanged")) throw e;
      const theirs = await remote.get(id);
      ({ fields: write, conflict } = mergeFields(base, fields, theirs));
      version = theirs.updated_at;
      merged = true;
    }
  }
  throw new Error("The note keeps changing elsewhere; will retry");
}

export type SyncResult =
  | { status: "done" }
  | { status: "offline" }
  | { status: "unauthorized" }
  | { status: "error"; message: string };

/** Sends the outbox in order, one run at a time; a run asked for during one follows it. */
export class Syncer {
  onSettled: (o: Outcome) => void = () => {};
  private running: Promise<SyncResult> | null = null;
  private again = false;

  constructor(
    private outbox: Outbox,
    private remote: Remote,
  ) {}

  run(): Promise<SyncResult> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        let result: SyncResult;
        do {
          this.again = false;
          result = await this.pass();
        } while (this.again && result.status === "done");
        return result;
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async pass(): Promise<SyncResult> {
    for (const entry of this.outbox.all()) {
      try {
        const outcome = await push(entry, this.remote);
        this.outbox.settle(entry, outcome.note, outcome.merged);
        this.onSettled(outcome);
      } catch (e) {
        if (e instanceof Offline) return { status: "offline" };
        if (e instanceof Unauthorized) return { status: "unauthorized" };
        // Kept for the next run: stopping here keeps later edits behind the one that failed.
        return { status: "error", message: e instanceof Error ? e.message : String(e) };
      }
    }
    return { status: "done" };
  }
}

/** A note known only to this device so far, as the list and editor show it. */
export function localNote(id: string, fields: Fields): Note {
  const now = new Date().toISOString();
  return {
    id,
    ...fields,
    title: fields.title.trim() || deriveTitle(fields.body),
    author: "human",
    created_at: now,
    updated_at: now,
    progress: progress(fields.body),
  };
}

/**
 * The list as it will be once the outbox is sent: pending edits applied, pending deletes gone,
 * and (`withNew`) notes made here that the server hasn't seen on top.
 */
export function withPending(notes: Note[], pending: Pending[], withNew: boolean): Note[] {
  const byId = new Map(pending.map((p) => [p.id, p]));
  const shown = notes
    .filter((n) => byId.get(n.id)?.op !== "delete")
    .map((n) => {
      const p = byId.get(n.id);
      return p?.op === "save" ? { ...localNote(n.id, p.fields), ...pick(n) } : n;
    });
  if (!withNew) return shown;
  const known = new Set(notes.map((n) => n.id));
  const fresh = pending.flatMap((p) =>
    p.op === "save" && p.base === null && !known.has(p.id) ? [localNote(p.id, p.fields)] : [],
  );
  return [...fresh.reverse(), ...shown];
}

// What a pending edit doesn't change about a listed note.
const pick = ({ author, created_at, updated_at }: Note) => ({ author, created_at, updated_at });
