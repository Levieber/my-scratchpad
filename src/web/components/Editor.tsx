import { History } from "@/web/components/History";
import type { FullRevision, Note } from "@/web/lib/api";
import type { Draft } from "@/web/lib/draft";
import { ago } from "@/web/lib/listing";

/** The right column: the open note's form, or its history. It holds no state of its own. */
export function Editor({
  draft,
  onEdit,
  current,
  showHistory,
  historyDisabled,
  historyHint,
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
    <main className="editor">
      <header className="bar">
        <button className="ghost back" aria-label="Back to list" onClick={onBack}>
          ←
        </button>
        <button
          className="ghost toggleList"
          aria-label={listHidden ? "Show note list" : "Hide note list"}
          aria-expanded={!listHidden}
          onClick={onToggleList}
        >
          {listHidden ? "»" : "«"}
        </button>
        <input
          className="title"
          placeholder="Title"
          value={draft.title}
          onChange={(e) => onEdit({ title: e.target.value })}
        />
        <button
          className="ghost kindToggle"
          aria-pressed={draft.kind === "reference"}
          title="Reference: reusable rules to check work against (practices, checklists)"
          onClick={() => onEdit({ kind: draft.kind === "reference" ? "note" : "reference" })}
        >
          Reference
        </button>
        <button
          className="ghost kindToggle"
          aria-pressed={showHistory}
          disabled={historyDisabled}
          title={historyHint}
          onClick={onToggleHistory}
        >
          History
        </button>
        <button className="ghost danger" title="Delete" onClick={onDelete}>
          🗑
        </button>
      </header>
      {showHistory && current ? (
        <History key={current.id} noteId={current.id} onRestore={onRestore} />
      ) : (
        <>
          <input
            className="tagsInput"
            placeholder="tags, comma separated"
            value={draft.tags}
            onChange={(e) => onEdit({ tags: e.target.value })}
          />
          <textarea
            ref={bodyRef}
            placeholder="Write anything. Markdown welcome."
            value={draft.body}
            onChange={(e) => onEdit({ body: e.target.value })}
          />
        </>
      )}
      <footer className="foot">
        <span>
          {current ? `by ${current.author} · created ${ago(current.created_at)}` : "new note"}
        </span>
        {/* Announced, since it can say an edit is only on this device or conflicted. */}
        <output>{saveLabel}</output>
      </footer>
    </main>
  );
}
