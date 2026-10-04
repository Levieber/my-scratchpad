// What the PWA's sync logic talks to in tests: an in-memory server with the API's write rules, and
// a localStorage stand-in.
import type { Note, NoteInput } from "@/shared/domain";
import { ApiError, Offline } from "@/web/lib/api";
import type { Fields } from "@/web/lib/outbox";

export const fields = (patch: Partial<Fields> = {}): Fields => ({
  title: "",
  body: "",
  tags: [],
  kind: "note",
  ...patch,
});

/** An in-memory server with the API's write rules: versions, If-Match, 404 and 409. */
export function fakeServer() {
  const notes = new Map<string, Note>();
  let clock = 0;
  const state = { offline: false, calls: [] as string[] };
  const stamp = () => new Date(Date.UTC(2026, 8, 29, 12, 0, 0, ++clock)).toISOString();
  const guard = (call: string) => {
    if (state.offline) throw new Offline();
    state.calls.push(call);
  };
  const missing = () => new ApiError(404, "noteNotFound", "Note not found");
  const server = {
    state,
    notes,
    /** A write made elsewhere (an agent, another device). */
    edit(id: string, patch: Partial<Fields>) {
      notes.set(id, { ...notes.get(id)!, ...patch, updated_at: stamp() });
    },
    remote: {
      create: async (input: NoteInput) => {
        guard("create");
        const id = input.id!;
        if (notes.has(id)) throw new ApiError(409, "noteExists", "exists");
        const now = stamp();
        const note: Note = {
          ...fields(),
          ...input,
          id,
          author: "human",
          created_at: now,
          updated_at: now,
          progress: { done: 0, total: 0 },
        } as Note;
        notes.set(id, note);
        return note;
      },
      update: async (id: string, patch: NoteInput, ifMatch?: string) => {
        guard("update");
        const cur = notes.get(id);
        if (!cur) throw missing();
        if (ifMatch && ifMatch !== cur.updated_at)
          throw new ApiError(412, "noteChanged", "changed");
        const next = { ...cur, ...patch, updated_at: stamp() } as Note;
        notes.set(id, next);
        return next;
      },
      get: async (id: string) => {
        guard("get");
        const cur = notes.get(id);
        if (!cur) throw missing();
        return cur;
      },
      delete: async (id: string) => {
        guard("delete");
        if (!notes.delete(id)) throw missing();
      },
    },
  };
  return server;
}

export function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}
