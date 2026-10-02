import { operatorValue } from "@/shared/query";
import { Filters } from "@/web/components/Filters";
import { NoteList } from "@/web/components/NoteList";
import { SavedViews } from "@/web/components/SavedViews";
import { TagChips } from "@/web/components/TagChips";
import type { Note, Tag, View } from "@/web/lib/api";
import { field, footer, primaryButton } from "@/web/lib/classes";
import type { PinState } from "@/web/lib/pins";
import { cn } from "@/web/lib/utils";

/** The left column: search, filters, saved views, tags and the list. It holds no state of its own. */
export function Sidebar({
  layout,
  q,
  onFilter,
  searchRef,
  onNew,
  views,
  onSaveView,
  onRemoveView,
  tags,
  notes,
  pinned,
  pinOf,
  onTogglePin,
  onDelete,
  currentId,
  canLoadMore,
  onLoadMore,
  onOpen,
  online,
  pendingChanges,
}: {
  /**
   * `page`: the list is the whole screen. `column`: beside the editor, and gone on a phone.
   * `hidden`: put away, but kept, with what it holds (a view name being typed, say).
   */
  layout: "page" | "column" | "hidden";
  q: string;
  onFilter: (next: string) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  onNew: () => void;
  views: View[];
  onSaveView: (name: string) => Promise<"saved" | "taken" | "failed">;
  onRemoveView: (view: View) => void;
  tags: Tag[];
  notes: Note[];
  pinned: Note[];
  pinOf: (id: string) => PinState;
  onTogglePin: (note: Note) => void;
  onDelete: (note: Note) => void;
  currentId: string | undefined;
  canLoadMore: boolean;
  onLoadMore: () => void;
  onOpen: (id: string) => void;
  online: boolean;
  pendingChanges: number;
}) {
  return (
    <aside
      className={cn(
        "flex min-h-0 flex-col gap-2.5 px-3 py-3.5 max-wide:px-4 max-wide:py-3",
        layout === "page" && "mx-auto w-full max-w-[820px] wide:px-5",
        layout === "column" && "max-wide:hidden",
        layout === "hidden" && "hidden",
      )}
    >
      <header className="flex items-center gap-2">
        <h1 className="flex-1 text-[1.0625rem] font-bold tracking-[-0.01em]">Scratchpad</h1>
        <button className={primaryButton} title="New note (Ctrl+Alt+N)" onClick={onNew}>
          + New
        </button>
      </header>
      <input
        ref={searchRef}
        className={field}
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
        pinned={pinned}
        pinOf={pinOf}
        onTogglePin={onTogglePin}
        onDelete={onDelete}
        currentId={currentId}
        kind={operatorValue(q, "kind")}
        searching={q !== ""}
        roomy={layout === "page"}
        canLoadMore={canLoadMore}
        onOpen={onOpen}
        onLoadMore={onLoadMore}
      />
      <footer className={footer}>
        <output>
          <span
            aria-hidden="true"
            className={cn("mr-1", online ? "text-success" : "text-destructive")}
          >
            ●
          </span>
          {online ? "online" : "offline"}
          {pendingChanges > 0 &&
            ` · ${pendingChanges} ${pendingChanges === 1 ? "change" : "changes"} to sync`}
        </output>
        <a
          className="inline-flex min-h-6 min-w-6 items-center px-1 underline"
          href="/openapi.json"
          target="_blank"
        >
          API
        </a>
      </footer>
    </aside>
  );
}
