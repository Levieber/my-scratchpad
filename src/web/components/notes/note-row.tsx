import { NoteMenu } from "@/web/components/notes/note-menu";
import { NoteMeta } from "@/web/components/notes/note-meta";
import { openNote } from "@/web/hooks/editor.hook";
import type { Note } from "@/web/lib/api";
import { preview } from "@/web/lib/listing";
import { cn } from "@/web/lib/utils";

/** One note in the list: the note itself (opens it) and its menu. */
export function NoteRow({
  note: n,
  inPinned,
  current,
  kind,
  roomy,
}: {
  note: Note;
  /** Listed under Pinned, which says so already. */
  inPinned: boolean;
  /** The note open in the editor. */
  current: boolean;
  /** The kind filter in force, so it isn't repeated on every row. */
  kind: string;
  /** The list is the whole screen: previews get a line more. */
  roomy: boolean;
}) {
  const p = preview(n);
  return (
    // The row is the card, holding the note (a button) and its menu trigger at the right edge:
    // one button can't hold another.
    <li
      className={cn(
        "group/row flex items-start rounded-card border border-transparent hover:bg-card",
        current && "border-border bg-card",
      )}
    >
      {/* A real button, so the list works from the keyboard and screen readers. */}
      <button
        className="block min-w-0 flex-1 rounded-card p-2.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
        aria-current={current}
        onClick={() => void openNote(n.id)}
      >
        <span className="line-clamp-2 font-semibold wrap-anywhere">{n.title}</span>
        {p && (
          <span
            className={cn(
              "line-clamp-2 text-[0.8125rem] text-muted-foreground wrap-anywhere",
              roomy && "line-clamp-3",
            )}
          >
            {p}
          </span>
        )}
        <NoteMeta note={n} inPinned={inPinned} kind={kind} className="mt-0.5" />
      </button>
      <NoteMenu note={n} className="mt-1 mr-0.5 desktop-mouse:mt-2 desktop-mouse:mr-1.5" />
    </li>
  );
}
