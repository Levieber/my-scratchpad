// How `pad` prints a note for a person. Pure, so it can be tested without a terminal.
import type { Note } from "@/shared/domain";

const ago = (iso: string) => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};

// Progress means something on a to-do list; on a reference checklist it's just the item count.
const done = (n: Note) =>
  n.kind === "note" && n.progress.total ? ` ${n.progress.done}/${n.progress.total}` : "";

// A page with notes under it says how many, for `pad ls --parent <id>` to open next.
const under = (n: Note) => (n.subpages ? ` +${n.subpages} under` : "");

/** One line per note, for lists. */
export const line = (n: Note) =>
  `${n.id}  ${n.title}${done(n)}${under(n)}${n.kind === "note" ? "" : ` [${n.kind}]`}${n.tags.length ? "  #" + n.tags.join(" #") : ""}  (${ago(n.updated_at)}, ${n.author})`;

/** A note with its header and body, for reading. */
export const full = (n: Note) =>
  `${n.title}\nid: ${n.id}${n.parent_id ? ` · under ${n.parent_id}` : ""} · by ${n.author} · updated ${n.updated_at}${
    n.tags.length ? " · #" + n.tags.join(" #") : ""
  }\n\n${n.body}`;
