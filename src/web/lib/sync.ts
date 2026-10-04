// Sending the outbox (outbox.ts): in order, merging with whatever changed on the server since an
// edit started. Kept apart from React so it can be tested directly.
import { merge3 } from "@/shared/diff/merge";
import { isApiError, Offline, Unauthorized, type Note, type NoteInput } from "@/web/lib/api";
import type { Fields, Outbox, Pending } from "@/web/lib/outbox";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Field by field, the side that changed wins; the body is merged line by line (shared/diff/merge.ts). */
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
  private running: Promise<SyncResult> | null = null;
  private again = false;
  private listeners = new Set<(o: Outcome) => void>();

  constructor(
    private outbox: Outbox,
    private remote: Remote,
  ) {}

  /** What the server answered for each entry it accepted, as it does. */
  onSettled(fn: (o: Outcome) => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

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
        this.listeners.forEach((fn) => fn(outcome));
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
