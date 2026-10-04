import { PinIcon, PinOffIcon, Trash2Icon } from "lucide-react";

import { History } from "@/web/components/editor/history";
import { removeNote, useEditor, useLiveOpenNote } from "@/web/hooks/editor.hook";
import { bodyRef } from "@/web/hooks/focus";
import { useUnsyncedIds } from "@/web/hooks/pending.hook";
import { usePinOf, usePinToggle } from "@/web/hooks/pins.hook";
import { field, footer, ghostButton, iconButton } from "@/web/lib/classes";
import { saveLabel } from "@/web/lib/draft";
import { ago } from "@/web/lib/listing";
import { session } from "@/web/lib/session";
import { cn } from "@/web/lib/utils";

const textButton = cn(ghostButton, "text-[0.8125rem] text-muted-foreground");

/** The right column: the open note's form, or its history. */
export function Editor({
  listHidden,
  onToggleList,
}: {
  listHidden: boolean;
  onToggleList: () => void;
}) {
  const { draft, current, showHistory, saveState, saveError } = useEditor();
  useLiveOpenNote();
  const pin = usePinOf()(current?.id);
  const togglePin = usePinToggle();
  // History and pins live on the server, so a note it hasn't seen yet has neither.
  const unsyncedIds = useUnsyncedIds();
  const unsynced = current ? unsyncedIds.has(current.id) : false;
  return (
    <main className="flex min-h-0 flex-col gap-2.5 px-5 py-3.5 max-wide:px-4 max-wide:py-3">
      <header className="flex flex-wrap items-center gap-2">
        <button className={ghostButton} aria-label="Back to list" onClick={session.close}>
          ←
        </button>
        <button
          className={cn(ghostButton, "max-wide:hidden")}
          aria-label={listHidden ? "Show note list" : "Hide note list"}
          aria-expanded={!listHidden}
          onClick={onToggleList}
        >
          {listHidden ? "»" : "«"}
        </button>
        <input
          className={cn(
            field,
            "flex-[1_1_8rem] border-transparent bg-transparent pl-0 text-xl font-bold",
          )}
          placeholder="Title"
          value={draft.title}
          onChange={(e) => session.edit({ title: e.target.value })}
        />
        <button
          className={textButton}
          aria-pressed={draft.kind === "reference"}
          title="Reference: reusable rules to check work against (practices, checklists)"
          onClick={() => session.edit({ kind: draft.kind === "reference" ? "note" : "reference" })}
        >
          Reference
        </button>
        <button
          className={cn(ghostButton, iconButton)}
          aria-label={pin.pinned ? "Unpin" : "Pin"}
          aria-pressed={pin.pinned}
          disabled={pin.disabled}
          title={pin.hint}
          onClick={() => current && togglePin(current)}
        >
          {pin.pinned ? <PinOffIcon /> : <PinIcon />}
        </button>
        <button
          className={textButton}
          aria-pressed={showHistory}
          disabled={!current || unsynced}
          title={unsynced ? "History starts once the note has synced" : "What changed, and when"}
          onClick={() => void session.toggleHistory()}
        >
          History
        </button>
        <button
          className={cn(ghostButton, iconButton, "hover:text-destructive")}
          aria-label="Delete"
          title="Delete"
          onClick={() => removeNote()}
        >
          <Trash2Icon />
        </button>
      </header>
      {showHistory && current ? (
        <History key={current.id} noteId={current.id} onRestore={session.restore} />
      ) : (
        <>
          <input
            className={field}
            placeholder="tags, comma separated"
            value={draft.tags}
            onChange={(e) => session.edit({ tags: e.target.value })}
          />
          <textarea
            ref={bodyRef}
            className={cn(field, "min-h-0 flex-1 resize-none p-3.5 font-mono text-base/[1.6]")}
            placeholder="Write anything. Markdown welcome."
            value={draft.body}
            onChange={(e) => session.edit({ body: e.target.value })}
          />
        </>
      )}
      <footer className={footer}>
        <span>
          {current ? `by ${current.author} · created ${ago(current.created_at)}` : "new note"}
        </span>
        {/* Announced, since it can say an edit is only on this device or conflicted. */}
        <output>{saveLabel(saveState, saveError)}</output>
      </footer>
    </main>
  );
}
