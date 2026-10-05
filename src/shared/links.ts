// Links between notes: `[[Note title]]`, `[[id]]`, or `[[target|what it reads as]]`, pad's
// markdown extension (shared/markdown.ts). Pure, so the server finds backlinks and the PWA renders
// links by the same reading.
import { outsideFences } from "./checklist";

export type NoteLink = { target: string; text: string };

/** One link where it starts: `[[`, a target, an optional `|text`, `]]`, all on one line. */
export const NOTE_LINK = /\[\[([^[\]|\n]+?)(?:\|([^[\]\n]+?))?\]\]/;

// Code shows text as it is: a link written in it is an example, not a link.
const INLINE_CODE = /(`+)[^`]*?\1/g;

/** The links in `body`, in order, outside code. */
export function noteLinks(body: string): NoteLink[] {
  const found: NoteLink[] = [];
  const all = new RegExp(NOTE_LINK.source, "g");
  for (const line of outsideFences(body))
    for (const m of line.replace(INLINE_CODE, "").matchAll(all)) {
      const target = m[1]!.trim();
      if (target) found.push({ target, text: (m[2] ?? m[1]!).trim() });
    }
  return found;
}

/** Whether a link's `target` names the note with this id and title, by id or by title. */
export const namesNote = (target: string, note: { id: string; title: string }) =>
  target === note.id || sameTitle(target, note.title);

export const sameTitle = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();
