import { lazy, Suspense } from "react";

import { NoteBoard } from "@/web/components/notes/note-board";
import { NoteList } from "@/web/components/notes/note-list";
import { PageTree } from "@/web/components/notes/page-tree";
import { useLayout } from "@/web/hooks/layout.hook";
import { useListed } from "@/web/hooks/listed.hook";
import { useWide } from "@/web/hooks/wide.hook";

// TanStack Table comes with the table alone: a chunk of its own, loaded when it is first shown.
const NoteTable = lazy(() =>
  import("@/web/components/notes/note-table").then((m) => ({ default: m.NoteTable })),
);

/**
 * The notes in the layout chosen for the search. Beside an open note the column is for moving
 * between notes, so it is the list, or the pages' tree, which is made for that; a phone's screen
 * shows the list in place of the table, which needs the room.
 */
export function Notes({
  beside,
}: {
  /** Beside the editor rather than the whole screen. */ beside: boolean;
}) {
  const listed = useListed();
  const { layout, unknown } = useLayout();
  const wide = useWide();
  const shown = (beside && layout !== "pages") || (layout === "table" && !wide) ? "list" : layout;
  return (
    <nav className="min-h-0 flex-1 scroll-column" aria-label="Notes" data-layout={shown}>
      {unknown && !beside && (
        <p className="mx-2.5 mb-2 text-xs text-muted-foreground" role="note">
          This view is shown as “{unknown}” in a newer version of the app: update to see it. Here it
          is a list.
        </p>
      )}
      {shown === "pages" ? (
        <PageTree listed={listed} />
      ) : shown === "board" ? (
        <NoteBoard listed={listed} />
      ) : shown === "table" ? (
        <Suspense>
          <NoteTable listed={listed} />
        </Suspense>
      ) : (
        <NoteList listed={listed} grid={shown === "grid"} roomy={!beside} />
      )}
    </nav>
  );
}
