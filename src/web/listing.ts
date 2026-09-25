// Pure helpers behind the note list, kept apart from React so they can be tested directly.
import type { Note } from "../db";
import type { Tag } from "./api";

const stripLine = (line: string) =>
  line
    .replace(/^\s*(#{1,6}\s+|>\s?)/, "")
    .replace(/^\s*([-*+]|\d+[.)])\s+/, "")
    .replace(/^\[[ xX]\]\s+/, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__|`/g, "")
    .replace(/(^|\W)[*_]([^*_]+)[*_](?=\W|$)/g, "$1$2")
    .trim();

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The note's body as one line of plain text for the list. Agents often start the body with the
 * title again, which would spend the preview repeating what the list already shows.
 */
export function preview(note: Note, max = 240): string {
  const lines = note.body
    .split("\n")
    .filter((l) => !/^\s*```/.test(l))
    .map(stripLine)
    .filter(Boolean);
  if (lines[0] && same(lines[0], note.title)) lines.shift();
  const text = lines.join(" · ");
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

export type Group = { label: string; notes: Note[] };

/** Splits the API's order (pinned, then most recently updated) into labelled sections. */
export function groupNotes(notes: Note[], now = new Date()): Group[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const week = today - 6 * 86_400_000;
  const groups: Group[] = [
    { label: "Pinned", notes: [] },
    { label: "Today", notes: [] },
    { label: "Previous 7 days", notes: [] },
    { label: "Earlier", notes: [] },
  ];
  for (const n of notes) {
    const t = Date.parse(n.updated_at);
    const i = n.pinned ? 0 : t >= today ? 1 : t >= week ? 2 : 3;
    groups[i]!.notes.push(n);
  }
  return groups.filter((g) => g.notes.length);
}

/** The first `limit` tags (the API sorts them by use), plus the selected ones wherever they rank. */
export function visibleTags(tags: Tag[], selected: string[], limit: number): Tag[] {
  const top = tags.slice(0, limit);
  return [...top, ...tags.slice(limit).filter((t) => selected.includes(t.tag))];
}
