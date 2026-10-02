import { operatorValue } from "@/shared/query";
import { Filters } from "@/web/components/Filters";
import { NoteList } from "@/web/components/NoteList";
import { SavedViews } from "@/web/components/SavedViews";
import { TagChips } from "@/web/components/TagChips";
import type { Note, Tag, View } from "@/web/lib/api";

/** The left column: search, filters, saved views, tags and the list. It holds no state of its own. */
export function Sidebar({
  q,
  onFilter,
  searchRef,
  onNew,
  views,
  onSaveView,
  onRemoveView,
  tags,
  notes,
  currentId,
  canLoadMore,
  onLoadMore,
  onOpen,
  online,
  pendingChanges,
}: {
  q: string;
  onFilter: (next: string) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  onNew: () => void;
  views: View[];
  onSaveView: (name: string) => Promise<"saved" | "taken" | "failed">;
  onRemoveView: (view: View) => void;
  tags: Tag[];
  notes: Note[];
  currentId: string | undefined;
  canLoadMore: boolean;
  onLoadMore: () => void;
  onOpen: (id: string) => void;
  online: boolean;
  pendingChanges: number;
}) {
  return (
    <aside className="sidebar">
      <header className="bar">
        <h1>Scratchpad</h1>
        <button className="primary" title="New note (Ctrl+Alt+N)" onClick={onNew}>
          + New
        </button>
      </header>
      <input
        ref={searchRef}
        type="search"
        placeholder="Search…  (/)"
        value={q}
        onChange={(e) => onFilter(e.target.value)}
      />
      <Filters q={q} onFilter={onFilter} />
      <SavedViews
        views={views}
        q={q}
        onFilter={onFilter}
        onSave={onSaveView}
        onRemove={onRemoveView}
      />
      <TagChips tags={tags} q={q} onFilter={onFilter} />
      <NoteList
        notes={notes}
        currentId={currentId}
        kind={operatorValue(q, "kind")}
        searching={q !== ""}
        canLoadMore={canLoadMore}
        onOpen={onOpen}
        onLoadMore={onLoadMore}
      />
      <footer className="foot">
        <output className={online ? "status" : "status off"}>
          {online ? "online" : "offline"}
          {pendingChanges > 0 &&
            ` · ${pendingChanges} ${pendingChanges === 1 ? "change" : "changes"} to sync`}
        </output>
        <a href="/openapi.json" target="_blank">
          API
        </a>
      </footer>
    </aside>
  );
}
