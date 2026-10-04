import { useState } from "react";

import { BoardCard, DRAGGED } from "@/web/components/notes/board-card";
import { GroupByPicker } from "@/web/components/notes/group-by";
import { ListEnd } from "@/web/components/notes/list-end";
import type { Listed } from "@/web/hooks/listed.hook";
import { useViewOption } from "@/web/hooks/view-option.hook";
import type { Note } from "@/web/lib/api";
import {
  type Column,
  columnOf,
  columnsOf,
  isGrouping,
  movable,
  movedTags,
  readGroupBy,
} from "@/web/lib/board";
import { retag } from "@/web/lib/retag";
import { session } from "@/web/lib/session";
import { outbox } from "@/web/lib/storage";
import { cn } from "@/web/lib/utils";

/**
 * The notes in columns by tag (`options.groupBy`, status:todo / doing / done by default). Moving
 * a note changes its tags through the outbox, so it works offline and shows in its history. On a
 * phone the columns stack.
 */
export function NoteBoard({ listed }: { listed: Listed }) {
  const { top, rest, currentId, kind } = listed;
  const [groupBy, setGroupBy] = useViewOption("groupBy", readGroupBy, { whole: true });
  const columns = columnsOf([...top, ...rest], groupBy);
  const targets = movable(groupBy) ? columns : [];
  const [over, setOver] = useState<string | null>(null);
  const [said, setSaid] = useState("");

  const move = (note: Note, to: Column) => {
    retag(session, outbox, note, movedTags(note.tags, groupBy, to));
    setSaid(`Moved “${note.title}” to ${to.label}`);
  };

  return (
    <>
      <div className="mb-2 flex items-center gap-2">
        <GroupByPicker key={JSON.stringify(groupBy)} value={groupBy} onChange={setGroupBy} />
        <output className="sr-only">{said}</output>
      </div>
      <div className="flex flex-col gap-3 wide:grid wide:auto-cols-[minmax(15rem,1fr)] wide:grid-flow-col wide:overflow-x-auto wide:pb-2">
        {columns.map((c) => (
          <section
            key={c.key}
            aria-label={c.label}
            className={cn(
              "flex min-w-0 flex-col rounded-card border border-transparent bg-muted/50 p-2",
              over === c.key && "border-primary",
            )}
            onDragOver={(e) => {
              if (!targets.length || !e.dataTransfer.types.includes(DRAGGED)) return;
              e.preventDefault();
              setOver(c.key);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const id = e.dataTransfer.getData(DRAGGED);
              const note = columnOf(columns, id)?.notes.find((n) => n.id === id);
              if (note && columnOf(columns, id) !== c) move(note, c);
            }}
          >
            <h2 className="mx-1 mb-2 flex items-baseline gap-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              <span className="min-w-0 wrap-anywhere">{c.label}</span>
              <span className="font-normal">{c.notes.length}</span>
            </h2>
            <ul className="flex flex-col gap-2">
              {c.notes.map((n) => (
                <BoardCard
                  key={n.id}
                  note={n}
                  current={currentId === n.id}
                  kind={kind}
                  columns={targets}
                  column={c}
                  tags={n.tags.filter((t) => !isGrouping(groupBy, t))}
                  onMove={move}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
      <ListEnd listed={listed} />
    </>
  );
}
