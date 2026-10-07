import { ChevronRightIcon } from "lucide-react";

import { ListEnd } from "@/web/components/notes/list-end";
import { NoteMenu } from "@/web/components/notes/note-menu";
import { NoteMarks } from "@/web/components/notes/note-meta";
import { DisclosureButton } from "@/web/components/shell/disclosure-button";
import { Hint } from "@/web/components/shell/hint";
import { ListMessage } from "@/web/components/shell/list-message";
import { Row } from "@/web/components/shell/row";
import { openNote } from "@/web/hooks/editor.hook";
import type { Listed } from "@/web/hooks/listed.hook";
import { MOST, useSubpages } from "@/web/hooks/pages.hook";
import { useStore } from "@/web/hooks/store.hook";
import type { Note } from "@/web/lib/api";
import { Store } from "@/web/lib/store";
import { cn } from "@/web/lib/utils";

// Which pages are open, kept while the app is: switching layout or opening a note keeps them.
const expanded = new Store<ReadonlySet<string>>(new Set());

const toggle = (id: string) => {
  const next = new Set(expanded.get());
  if (!next.delete(id)) next.add(id);
  expanded.set(next);
};

/**
 * The notes as pages under pages. Without a search, from the pages at the top; with one, its
 * results, each opening onto what is under it. A page's notes load when it is opened.
 */
export function PageTree({ listed }: { listed: Listed }) {
  const { searching, top, rest, currentId } = listed;
  return (
    <>
      <ul aria-label="Pages">
        {searching ? (
          [...top, ...rest].map((n) => (
            <PageNode key={n.id} note={n} depth={0} currentId={currentId} />
          ))
        ) : (
          <Branch parent={null} depth={0} currentId={currentId} />
        )}
      </ul>
      {searching && <ListEnd listed={listed} />}
    </>
  );
}

function Branch({
  parent,
  depth,
  currentId,
}: {
  parent: string | null;
  depth: number;
  currentId: string | undefined;
}) {
  const notes = useSubpages(parent);
  if (parent === null && notes.length === 0)
    return <ListMessage render={<li />}>No notes yet.</ListMessage>;
  return (
    <>
      {notes.map((n) => (
        <PageNode key={n.id} note={n} depth={depth} currentId={currentId} />
      ))}
      {notes.length >= MOST && (
        // The server sends the latest; the rest would be missing without a word.
        <ListMessage render={<li />}>
          The {MOST} most recently changed are shown here: search for the rest.
        </ListMessage>
      )}
    </>
  );
}

function PageNode({
  note: n,
  depth,
  currentId,
}: {
  note: Note;
  depth: number;
  currentId: string | undefined;
}) {
  const open = useStore(expanded).has(n.id);
  const current = currentId === n.id;
  return (
    <li>
      <Row
        current={current}
        // Deep trees stop indenting past a few levels, so a phone keeps room for the title.
        style={{ "--depth": Math.min(depth, 6) } as React.CSSProperties}
        className="flex items-center gap-0.5 pl-[calc(var(--depth)*1.25rem)]"
      >
        {n.subpages > 0 ? (
          <Hint label={open ? "Hide the pages under it" : "Show the pages under it"}>
            <DisclosureButton
              size="icon-sm"
              className="text-muted-foreground"
              aria-expanded={open}
              aria-label={`${open ? "Close" : "Open"} the pages under "${n.title}"`}
              onClick={() => toggle(n.id)}
            >
              <ChevronRightIcon className={cn("transition-transform", open && "rotate-90")} />
            </DisclosureButton>
          </Hint>
        ) : (
          <span className="size-8 flex-none" />
        )}
        <button
          className="min-w-0 flex-1 rounded-md px-1.5 py-1.5 text-left text-sm wrap-anywhere focus-ring-inset"
          aria-current={current}
          onClick={() => void openNote(n.id)}
        >
          <NoteMarks note={n} inPinned={false} />
          <span className={cn(current && "font-semibold")}>{n.title}</span>
          {n.subpages > 0 && (
            // Out of the name: the button beside it already says there are pages under it.
            <span className="ml-1.5 text-xs text-muted-foreground" aria-hidden="true">
              {n.subpages}
            </span>
          )}
        </button>
        <NoteMenu note={n} className="mr-0.5" />
      </Row>
      {open && (
        <ul>
          <Branch parent={n.id} depth={depth + 1} currentId={currentId} />
        </ul>
      )}
    </li>
  );
}
