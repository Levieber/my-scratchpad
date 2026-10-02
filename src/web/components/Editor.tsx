import { PinIcon, PinOffIcon, Trash2Icon } from "lucide-react";

import { History } from "@/web/components/History";
import type { FullRevision, Note } from "@/web/lib/api";
import { field, footer, ghostButton, iconButton } from "@/web/lib/classes";
import type { Draft } from "@/web/lib/draft";
import { ago } from "@/web/lib/listing";
import type { PinState } from "@/web/lib/pins";
import { cn } from "@/web/lib/utils";

const textButton = cn(ghostButton, "text-[0.8125rem] text-muted-foreground");

/** The right column: the open note's form, or its history. It holds no state of its own. */
export function Editor({
  draft,
  onEdit,
  current,
  showHistory,
  historyDisabled,
  historyHint,
  pin,
  onTogglePin,
  listHidden,
  onToggleList,
  onBack,
  onToggleHistory,
  onDelete,
  onRestore,
  bodyRef,
  saveLabel,
}: {
  draft: Draft;
  onEdit: (patch: Partial<Draft>) => void;
  current: Note | null;
  showHistory: boolean;
  historyDisabled: boolean;
  historyHint: string;
  pin: PinState;
  onTogglePin: () => void;
  listHidden: boolean;
  onToggleList: () => void;
  onBack: () => void;
  onToggleHistory: () => void;
  onDelete: () => void;
  onRestore: (revision: FullRevision) => void;
  bodyRef: React.RefObject<HTMLTextAreaElement | null>;
  saveLabel: string;
}) {
  return (
    <main className="flex min-h-0 flex-col gap-2.5 px-5 py-3.5 max-wide:px-4 max-wide:py-3">
      <header className="flex flex-wrap items-center gap-2">
        <button className={ghostButton} aria-label="Back to list" onClick={onBack}>
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
          onChange={(e) => onEdit({ title: e.target.value })}
        />
        <button
          className={textButton}
          aria-pressed={draft.kind === "reference"}
          title="Reference: reusable rules to check work against (practices, checklists)"
          onClick={() => onEdit({ kind: draft.kind === "reference" ? "note" : "reference" })}
        >
          Reference
        </button>
        <button
          className={cn(ghostButton, iconButton)}
          aria-label={pin.pinned ? "Unpin" : "Pin"}
          aria-pressed={pin.pinned}
          disabled={pin.disabled}
          title={pin.hint}
          onClick={onTogglePin}
        >
          {pin.pinned ? <PinOffIcon /> : <PinIcon />}
        </button>
        <button
          className={textButton}
          aria-pressed={showHistory}
          disabled={historyDisabled}
          title={historyHint}
          onClick={onToggleHistory}
        >
          History
        </button>
        <button
          className={cn(ghostButton, iconButton, "hover:text-destructive")}
          aria-label="Delete"
          title="Delete"
          onClick={onDelete}
        >
          <Trash2Icon />
        </button>
      </header>
      {showHistory && current ? (
        <History key={current.id} noteId={current.id} onRestore={onRestore} />
      ) : (
        <>
          <input
            className={field}
            placeholder="tags, comma separated"
            value={draft.tags}
            onChange={(e) => onEdit({ tags: e.target.value })}
          />
          <textarea
            ref={bodyRef}
            className={cn(field, "min-h-0 flex-1 resize-none p-3.5 font-mono text-base/[1.6]")}
            placeholder="Write anything. Markdown welcome."
            value={draft.body}
            onChange={(e) => onEdit({ body: e.target.value })}
          />
        </>
      )}
      <footer className={footer}>
        <span>
          {current ? `by ${current.author} · created ${ago(current.created_at)}` : "new note"}
        </span>
        {/* Announced, since it can say an edit is only on this device or conflicted. */}
        <output>{saveLabel}</output>
      </footer>
    </main>
  );
}
