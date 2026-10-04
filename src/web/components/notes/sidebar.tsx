import { Filters } from "@/web/components/notes/filters";
import { ListFooter } from "@/web/components/notes/list-footer";
import { NoteList } from "@/web/components/notes/note-list";
import { TagChips } from "@/web/components/notes/tag-chips";
import { SavedViews } from "@/web/components/views/saved-views";
import { useSearch } from "@/web/hooks/data.hook";
import { newNote, searchRef } from "@/web/hooks/focus";
import { field, primaryButton } from "@/web/lib/classes";
import { cn } from "@/web/lib/utils";

/** The left column: search, filters, saved views, tags and the list. */
export function Sidebar({
  layout,
}: {
  /**
   * `page`: the list is the whole screen. `column`: beside the editor, and gone on a phone.
   * `hidden`: put away, but kept, with what it holds (a view name being typed, say).
   */
  layout: "page" | "column" | "hidden";
}) {
  const { q, filter } = useSearch();
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
        <button className={primaryButton} title="New note (Ctrl+Alt+N)" onClick={newNote}>
          + New
        </button>
      </header>
      <input
        ref={searchRef}
        className={field}
        type="search"
        placeholder="Search…  (Ctrl+K)"
        aria-keyshortcuts="Control+K Meta+K"
        value={q}
        onChange={(e) => filter(e.target.value)}
      />
      <Filters />
      <SavedViews />
      <TagChips />
      <NoteList roomy={layout === "page"} />
      <ListFooter />
    </aside>
  );
}
