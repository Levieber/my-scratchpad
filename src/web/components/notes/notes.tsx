import { lazy, Suspense } from "react";

import { NoteList } from "@/web/components/notes/note-list";
import { useLayout } from "@/web/hooks/layout.hook";
import { useListed } from "@/web/hooks/listed.hook";
import { useWide } from "@/web/hooks/wide.hook";

// TanStack Table comes with the table alone: a chunk of its own, loaded when it is first shown.
const NoteTable = lazy(() =>
  import("@/web/components/notes/note-table").then((m) => ({ default: m.NoteTable })),
);

/**
 * The notes in the layout chosen for the search. Beside an open note the column is for moving
 * between notes, so it is the list; so is a phone's screen in place of the table, which needs
 * the room.
 */
export function Notes({
  beside,
}: {
  /** Beside the editor rather than the whole screen. */ beside: boolean;
}) {
  const listed = useListed();
  const { layout, unknown } = useLayout();
  const wide = useWide();
  const shown = beside || (layout === "table" && !wide) ? "list" : layout;
  return (
    <nav className="flex-1 overflow-y-auto" aria-label="Notes" data-layout={shown}>
      {unknown && !beside && (
        <p className="mx-2.5 mb-2 text-xs text-muted-foreground" role="note">
          This view is shown as “{unknown}” in a newer version of the app: update to see it. Here it
          is a list.
        </p>
      )}
      {shown === "table" ? (
        <Suspense>
          <NoteTable listed={listed} />
        </Suspense>
      ) : (
        <NoteList listed={listed} grid={shown === "grid"} roomy={!beside} />
      )}
    </nav>
  );
}
