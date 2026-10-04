import { operatorValue } from "@/shared/query";
import { NoteRow } from "@/web/components/notes/note-row";
import { useEditor } from "@/web/hooks/editor.hook";
import { useNotes, usePins } from "@/web/hooks/notes.hook";
import { useSearch } from "@/web/hooks/search.hook";
import type { Note } from "@/web/lib/api";
import { moreButton } from "@/web/lib/classes";
import { groupNotes } from "@/web/lib/listing";
import { cn } from "@/web/lib/utils";

const heading =
  "mx-2.5 mt-3 mb-1 text-[0.6875rem] font-semibold tracking-wider text-muted-foreground uppercase group-first/section:mt-0";

/**
 * The notes, grouped by when they changed. Unless searching, the pinned notes come first and
 * aren't listed again below.
 */
export function NoteList({ roomy }: { /** The list is the whole screen. */ roomy: boolean }) {
  const { q, asked, limit, loadMore } = useSearch();
  const { notes, canLoadMore } = useNotes(asked, limit);
  const pinned = usePins();
  const currentId = useEditor().current?.id;
  const searching = q !== "";
  const kind = operatorValue(q, "kind");

  const top = searching ? [] : pinned;
  const isTop = new Set(top.map((n) => n.id));
  const rest = notes.filter((n) => !isTop.has(n.id));
  const row = (n: Note, inPinned = false) => (
    <NoteRow
      key={n.id}
      note={n}
      inPinned={inPinned}
      current={currentId === n.id}
      kind={kind}
      roomy={roomy}
    />
  );

  return (
    <nav className="flex-1 overflow-y-auto" aria-label="Notes">
      {top.length > 0 && (
        <section className="group/section" aria-label="Pinned">
          <h2 className={heading}>Pinned</h2>
          <ul>{top.map((n) => row(n, true))}</ul>
        </section>
      )}
      {groupNotes(rest).map((g) => (
        <section key={g.label} className="group/section" aria-label={g.label}>
          <h2 className={heading}>{g.label}</h2>
          <ul>{g.notes.map((n) => row(n))}</ul>
        </section>
      ))}
      {notes.length === 0 && top.length === 0 && (
        <p className="p-2.5 text-xs text-muted-foreground">
          {searching ? "No matches." : "No notes yet."}
        </p>
      )}
      {canLoadMore && (
        <button className={cn(moreButton, "mx-auto my-2 block")} onClick={loadMore}>
          Load more
        </button>
      )}
    </nav>
  );
}
