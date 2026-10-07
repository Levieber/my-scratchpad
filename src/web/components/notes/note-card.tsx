import { lazy, Suspense } from "react";

import { NoteMenu } from "@/web/components/notes/note-menu";
import { NoteMeta } from "@/web/components/notes/note-meta";
import { ClickableCard, CoverButton } from "@/web/components/shell/clickable-card";
import { openNote } from "@/web/hooks/editor.hook";
import type { Note } from "@/web/lib/api";
import { cardBody, preview } from "@/web/lib/listing";

// The renderer's own chunk, the one the Read view loads; the plain preview shows until it has.
const NoteMarkdown = lazy(() =>
  import("@/web/components/editor/note-markdown").then((m) => ({ default: m.NoteMarkdown })),
);

/** One note in the grid: its title (opens it), the start of its body rendered, and its menu. */
export function NoteCard({
  note: n,
  inPinned,
  current,
  kind,
}: {
  note: Note;
  inPinned: boolean;
  current: boolean;
  kind: string;
}) {
  const body = cardBody(n);
  return (
    <ClickableCard render={<li />} current={current} className="min-h-36 p-3">
      <div className="flex items-start gap-1">
        <CoverButton aria-current={current} onClick={() => void openNote(n.id)}>
          <span className="line-clamp-2">{n.title}</span>
        </CoverButton>
        <NoteMenu note={n} className="relative z-10 -mt-1.5 -mr-1.5" />
      </div>
      {body && (
        // A glimpse, not the note: nothing in it is focusable or clickable (a link, a box), so
        // a click anywhere opens the note.
        <div
          inert
          className="pointer-events-none mt-1 max-h-40 overflow-hidden text-caption text-muted-foreground mask-b-from-70% [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-sm"
        >
          <Suspense fallback={<p className="wrap-anywhere">{preview(n)}</p>}>
            <NoteMarkdown body={body} />
          </Suspense>
        </div>
      )}
      <NoteMeta note={n} inPinned={inPinned} kind={kind} className="mt-auto pt-2" />
    </ClickableCard>
  );
}
