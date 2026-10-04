// Offline editing. Every edit waits in the outbox (kept in localStorage) until the server has it,
// so nothing typed is lost to a dropped connection, a closed tab, or someone else's write: an
// edit carries the version it started from, and if the note changed since, the two are merged
// (sync.ts). Kept apart from React so it can be tested directly.
import type { Kind } from "@/shared/kinds";
import type { Note } from "@/web/lib/api";

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
  // The same array until something changes, so React can tell when it did (useSyncExternalStore).
  private snapshot: readonly Pending[] = [];
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
    this.snapshot = [...this.entries.values()];
  }

  all = (): readonly Pending[] => this.snapshot;
  get = (id: string): Pending | undefined => this.entries.get(id);

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };

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
    this.snapshot = [...this.entries.values()];
    try {
      this.storage?.setItem(this.key, JSON.stringify(this.all()));
    } catch {}
    this.listeners.forEach((fn) => fn());
  }
}
