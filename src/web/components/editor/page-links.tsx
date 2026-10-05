import { ChevronRightIcon, PlusIcon } from "lucide-react";

import { Button } from "@/web/components/ui/button";
import { openNote } from "@/web/hooks/editor.hook";
import { newSubpage } from "@/web/hooks/focus";
import { usePath, useSubpages } from "@/web/hooks/pages.hook";
import type { Note } from "@/web/lib/api";

const link =
  "min-w-0 truncate rounded-sm hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-primary";

/** The pages above the open note, from the top down; each opens. Nothing for a note at the top. */
export function Breadcrumbs({ note }: { note: Note | null }) {
  const path = usePath(note);
  if (!path.length) return null;
  return (
    <nav aria-label="Breadcrumb" className="-mb-1 text-xs text-muted-foreground">
      <ol className="flex min-w-0 flex-wrap items-center gap-x-1">
        {path.map((page) => (
          <li key={page.id} className="flex min-w-0 items-center gap-x-1">
            <button className={`${link} min-h-6 max-w-48`} onClick={() => void openNote(page.id)}>
              {page.title}
            </button>
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
        <button
          key={page.id}
          className={`${link} min-h-6 max-w-56 text-muted-foreground`}
          onClick={() => void openNote(page.id)}
        >
          {page.title}
        </button>
      ))}
      <Button
        variant="ghost"
        size="xs"
        className="font-normal text-muted-foreground"
        onClick={() => newSubpage(note.id)}
      >
        <PlusIcon />
        Subpage
      </Button>
    </nav>
  );
}
