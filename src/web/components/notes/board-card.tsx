import { NoteMenu } from "@/web/components/notes/note-menu";
import { NoteMeta } from "@/web/components/notes/note-meta";
import {
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "@/web/components/ui/dropdown-menu";
import { openNote } from "@/web/hooks/editor.hook";
import type { Note } from "@/web/lib/api";
import type { Column } from "@/web/lib/board";
import { cn } from "@/web/lib/utils";

/** The type a dragged card carries, so a column takes only cards. */
export const DRAGGED = "application/x-pad-note";

/**
 * One note on a board: its title (opens it), its details and its menu. With somewhere to move
 * it, it can be dragged to a column, or moved with the menu's "Move to", which a keyboard and a
 * finger can use too.
 */
export function BoardCard({
  note: n,
  current,
  kind,
  columns,
  column,
  tags,
  onMove,
}: {
  note: Note;
  current: boolean;
  kind: string;
  /** Where it can be moved to; none when the board's columns can't be changed from here. */
  columns: readonly Column[];
  column: Column;
  /** Its tags, but those its column already says. */
  tags: readonly string[];
  onMove: (note: Note, to: Column) => void;
}) {
  const movable = columns.length > 0;
  return (
    <li
      className={cn(
        "group/row relative flex flex-col rounded-card border border-border bg-card p-2.5 hover:border-primary/50",
        current && "border-primary",
      )}
    >
      <div className="flex items-start gap-1">
        {/* Covers the card (its ::after), so a click anywhere opens the note, as in the grid,
            and a drag from anywhere moves it. */}
        <button
          draggable={movable}
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAGGED, n.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          className={cn(
            movable && "cursor-grab active:cursor-grabbing",
            "min-w-0 flex-1 text-left text-sm font-semibold wrap-anywhere after:absolute after:inset-0 after:rounded-card focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-primary",
          )}
          aria-current={current}
          onClick={() => void openNote(n.id)}
        >
          <span className="line-clamp-3">{n.title}</span>
        </button>
        <NoteMenu note={n} className="relative z-10 -mt-1.5 -mr-1.5">
          {movable && (
            <>
              <DropdownMenuGroup>
                <DropdownMenuLabel>Move to</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={column.key}
                  onValueChange={(key) => {
                    const to = columns.find((c) => c.key === key);
                    if (to && to !== column) onMove(n, to);
                  }}
                >
                  {columns.map((c) => (
                    <DropdownMenuRadioItem key={c.key} value={c.key}>
                      {c.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
            </>
          )}
        </NoteMenu>
      </div>
      <NoteMeta note={n} inPinned={false} kind={kind} tags={tags} className="mt-1" />
    </li>
  );
}
