import { ChevronRightIcon, PlusIcon } from "lucide-react";

import { QuietButton, QuietLinkButton } from "@/web/components/shell/quiet";
import { openNote } from "@/web/hooks/editor.hook";
import { newNote } from "@/web/hooks/focus";
import { useBacklinks, usePath, useSubpages } from "@/web/hooks/pages.hook";
import type { Note } from "@/web/lib/api";

/** The pages above the open note, from the top down; each opens. Nothing for a note at the top. */
export function Breadcrumbs({ note }: { note: Note | null }) {
  const path = usePath(note);
  if (!path.length) return null;
  return (
    <nav aria-label="Breadcrumb" className="-mb-1 text-xs text-muted-foreground">
      <ol className="flex min-w-0 flex-wrap items-center gap-x-1">
        {path.map((page) => (
          <li key={page.id} className="flex min-w-0 items-center gap-x-1">
            <QuietLinkButton className="max-w-48" onClick={() => void openNote(page.id)}>
              {page.title}
            </QuietLinkButton>
            <ChevronRightIcon className="size-3 flex-none" aria-hidden="true" />
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** The notes under the open note, each opening, and a new one under it. */
export function Subpages({ note }: { note: Note }) {
  const subpages = useSubpages(note.id, note.subpages > 0);
  return (
    <nav aria-label="Subpages" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      {subpages.length > 0 && <span className="text-muted-foreground">Subpages:</span>}
      {subpages.map((page) => (
        <QuietLinkButton key={page.id} className="max-w-56" onClick={() => void openNote(page.id)}>
          {page.title}
        </QuietLinkButton>
      ))}
      <QuietButton onClick={() => newNote("", note.id)}>
        <PlusIcon />
        Subpage
      </QuietButton>
    </nav>
  );
}

/** The notes that link to the open note; nothing when none does. */
export function LinkedFrom({ note }: { note: Note }) {
  const linking = useBacklinks(note);
  if (!linking.length) return null;
  return (
    <nav aria-label="Linked from" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span className="text-muted-foreground">Linked from:</span>
      {linking.map((n) => (
        <QuietLinkButton key={n.id} className="max-w-56" onClick={() => void openNote(n.id)}>
          {n.title}
        </QuietLinkButton>
      ))}
    </nav>
  );
}
