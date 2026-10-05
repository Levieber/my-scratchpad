// What the outbox means for what the app shows: notes as they will be once it is sent.
import { progress } from "@/shared/checklist";
import { deriveTitle } from "@/shared/title";
import type { Note } from "@/web/lib/api";
import type { Fields, Pending } from "@/web/lib/outbox";
import type { Outcome } from "@/web/lib/sync";

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
    parent_id: fields.parent_id ?? null,
    subpages: 0,
  };
}

/**
 * The list as it will be once the outbox is sent: pending edits applied, pending deletes gone,
 * and (`withNew`) notes made here that the server hasn't seen on top.
 */
export function withPending(notes: Note[], pending: readonly Pending[], withNew: boolean): Note[] {
  const byId = new Map(pending.map((p) => [p.id, p]));
  const shown = notes
    .filter((n) => byId.get(n.id)?.op !== "delete")
    .map((n) => {
      const p = byId.get(n.id);
      if (p?.op !== "save") return n;
      const parent_id = p.fields.parent_id === undefined ? n.parent_id : p.fields.parent_id;
      return { ...localNote(n.id, p.fields), ...pick(n), parent_id };
    });
  if (!withNew) return shown;
  const known = new Set(notes.map((n) => n.id));
  const fresh = pending.flatMap((p) =>
    p.op === "save" && p.base === null && !known.has(p.id) ? [localNote(p.id, p.fields)] : [],
  );
  return [...fresh.reverse(), ...shown];
}

// What a pending edit doesn't change about a listed note.
const pick = ({ author, created_at, updated_at, subpages }: Note) => ({
  author,
  created_at,
  updated_at,
  subpages,
});

/**
 * A list as the server has it once `outcome` landed: the saved note in place of the listed one
 * (on top when it is new and `withNew`), a deleted one gone. The outbox forgets an entry the
 * moment the server accepts it, so without this the list would show the note as it was until the
 * next refresh arrives.
 */
export function withSettled(notes: Note[], { sent, note }: Outcome, withNew: boolean): Note[] {
  if (sent.op === "delete") return notes.filter((n) => n.id !== sent.id);
  if (!note) return notes;
  const at = notes.findIndex((n) => n.id === note.id);
  if (at >= 0) return notes.with(at, note);
  return withNew && sent.base === null ? [note, ...notes] : notes;
}
