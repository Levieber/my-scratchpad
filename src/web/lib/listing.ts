// Pure helpers behind the note list, kept apart from React so they can be tested directly.
import type { Note } from "@/shared/domain";

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

/** How long ago `iso` was, briefly; a date once it's more than a day. */
export const ago = (iso: string) => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
};

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

/** Splits the API's order (most recently updated first) into labelled sections. */
export function groupNotes(notes: Note[], now = new Date()): Group[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const week = today - 6 * 86_400_000;
  const groups: Group[] = [
    { label: "Today", notes: [] },
    { label: "Previous 7 days", notes: [] },
    { label: "Earlier", notes: [] },
  ];
  for (const n of notes) {
    const t = Date.parse(n.updated_at);
    const i = t >= today ? 0 : t >= week ? 1 : 2;
    groups[i]!.notes.push(n);
  }
  return groups.filter((g) => g.notes.length);
}

/** The first `limit` tags (the API sorts them by use), plus the selected ones wherever they rank. */
export function visibleTags(tags: Tag[], selected: string[], limit: number): Tag[] {
  const top = tags.slice(0, limit);
  return [...top, ...tags.slice(limit).filter((t) => selected.includes(t.tag))];
}

/** The one value a toggle group's change pressed or released: in one list and not the other. */
export const toggled = <T>(before: readonly T[], after: readonly T[]): T | undefined =>
  after.find((v) => !before.includes(v)) ?? before.find((v) => !after.includes(v));
