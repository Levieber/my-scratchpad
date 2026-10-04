import { Filters } from "@/web/components/notes/filters";
import { LayoutPicker } from "@/web/components/notes/layout-picker";
import { ListFooter } from "@/web/components/notes/list-footer";
import { Notes } from "@/web/components/notes/notes";
import { TagChips } from "@/web/components/notes/tag-chips";
import { Hint } from "@/web/components/shell/hint";
import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";
import { SavedViews } from "@/web/components/views/saved-views";
import { newNote, searchRef } from "@/web/hooks/focus";
import { useLayout } from "@/web/hooks/layout.hook";
import { useSearch } from "@/web/hooks/search.hook";
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
  // Cards and columns need more room than rows: the page widens for them.
  const roomy = useLayout().layout !== "list";
  return (
    <aside
      className={cn(
        "flex min-h-0 flex-col gap-2.5 px-3 py-3.5 max-wide:px-4 max-wide:py-3",
        layout === "page" && "mx-auto w-full max-w-[820px] wide:px-5",
        layout === "page" && roomy && "max-w-[1200px]",
        layout === "column" && "max-wide:hidden",
        layout === "hidden" && "hidden",
      )}
    >
      <header className="flex items-center gap-2">
        <h1 className="flex-1 text-[1.0625rem] font-bold tracking-[-0.01em]">Scratchpad</h1>
        <Hint label="New note (Ctrl+Alt+N)">
          <Button aria-keyshortcuts="Control+Alt+N" onClick={newNote}>
            + New
          </Button>
        </Hint>
      </header>
      <div className="flex gap-2">
        <Input
          ref={searchRef}
          type="search"
          aria-label="Search"
          placeholder="Search…  (Ctrl+K)"
          aria-keyshortcuts="Control+K Meta+K"
          value={q}
          onChange={(e) => filter(e.target.value)}
        />
        {/* Beside a note the column is always the list (notes.tsx): nothing to pick there. */}
        {layout === "page" && <LayoutPicker />}
      </div>
      <Filters />
      <SavedViews />
      <TagChips />
      <Notes beside={layout !== "page"} />
      <ListFooter />
    </aside>
  );
}
