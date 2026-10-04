import { ListEnd } from "@/web/components/notes/list-end";
import { NoteCard } from "@/web/components/notes/note-card";
import { NoteRow } from "@/web/components/notes/note-row";
import type { Listed } from "@/web/hooks/listed.hook";
import type { Note } from "@/web/lib/api";
import { groupNotes } from "@/web/lib/listing";
import { cn } from "@/web/lib/utils";

const heading =
  "mx-2.5 mt-3 mb-1 text-[0.6875rem] font-semibold tracking-wider text-muted-foreground uppercase group-first/section:mt-0";

/**
 * The notes as rows (the list) or cards (the grid), grouped by when they changed, the pinned
 * ones first.
 */
export function NoteList({
  listed,
  grid,
  roomy,
}: {
  listed: Listed;
  grid: boolean;
  /** The list is the whole screen: previews get a line more. */
  roomy: boolean;
}) {
  const { top, rest, currentId, kind } = listed;
  const item = (n: Note, inPinned = false) => {
    const props = { note: n, inPinned, current: currentId === n.id, kind };
    return grid ? (
      <NoteCard key={n.id} {...props} />
    ) : (
      <NoteRow key={n.id} {...props} roomy={roomy} />
    );
  };
  const list = cn(grid && "grid grid-cols-[repeat(auto-fill,minmax(min(16rem,100%),1fr))] gap-3");
  const sections = [
    ...(top.length ? [{ label: "Pinned", notes: top, pinned: true }] : []),
    ...groupNotes(rest).map((g) => ({ ...g, pinned: false })),
  ];

  return (
    <>
      {sections.map((s) => (
        <section key={s.label} className={cn("group/section", grid && "mb-3")} aria-label={s.label}>
          <h2 className={heading}>{s.label}</h2>
          <ul className={list}>{s.notes.map((n) => item(n, s.pinned))}</ul>
        </section>
      ))}
      <ListEnd listed={listed} />
    </>
  );
}
