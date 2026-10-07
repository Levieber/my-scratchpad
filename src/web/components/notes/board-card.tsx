import { NoteMenu } from "@/web/components/notes/note-menu";
import { NoteMeta } from "@/web/components/notes/note-meta";
import { ClickableCard, CoverButton } from "@/web/components/shell/clickable-card";
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
    <ClickableCard render={<li />} current={current} className="p-2.5">
      <div className="flex items-start gap-1">
        {/* Covering the card, a drag from anywhere moves it too. */}
        <CoverButton
          draggable={movable}
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAGGED, n.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          className={cn("text-sm", movable && "cursor-grab active:cursor-grabbing")}
          aria-current={current}
          onClick={() => void openNote(n.id)}
        >
          <span className="line-clamp-3">{n.title}</span>
        </CoverButton>
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
    </ClickableCard>
  );
}
