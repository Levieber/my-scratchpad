import { PlusIcon } from "lucide-react";

import type { Layout } from "@/shared/layouts";
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
import { shortcutText } from "@/web/lib/keys";
import { cn } from "@/web/lib/utils";

const WIDE = new Set<Layout>(["grid", "table", "board"]);

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
  const roomy = WIDE.has(useLayout().layout);
  return (
    // The aside spans its grid cell; what it holds keeps to a centred column. The list scrolls
    // in its own column (scroll-column, index.css), its scrollbar at the column's edge, and the
    // search above it and the footer below keep the same gutter (aligned-column), so the three
    // line up.
    <aside
      className={cn(
        "flex min-h-0 flex-col gap-2.5 py-3.5 [--gutter:0.75rem] max-wide:py-3 max-wide:[--gutter:1rem]",
        layout === "page" && "[--column:820px] wide:[--gutter:1.25rem]",
        layout === "page" && roomy && "[--column:1200px]",
        layout === "column" && "max-wide:hidden",
        layout === "hidden" && "hidden",
      )}
    >
      <div className="flex aligned-column flex-col gap-2.5">
        <header className="flex items-center gap-2">
          <h1 className="flex-1 text-title font-bold">Scratchpad</h1>
          <Hint label="New note" keys="Ctrl+Alt+N">
            <Button aria-keyshortcuts="Control+Alt+N" onClick={() => newNote()}>
              <PlusIcon />
              New
            </Button>
          </Hint>
        </header>
        {/* The picker goes under the search where both don't fit (a narrow phone). */}
        <div className="flex flex-wrap gap-2">
          <Input
            className="min-w-48 flex-1"
            ref={searchRef}
            type="search"
            aria-label="Search"
            placeholder={`Search…  (${shortcutText("Mod+K")})`}
            aria-keyshortcuts="Control+K Meta+K"
            value={q}
            onChange={(e) => filter(e.target.value)}
          />
          {/* Beside a note the column keeps to what moves between notes (notes.tsx). */}
          {layout === "page" && <LayoutPicker />}
        </div>
        <Filters />
        <SavedViews narrow={layout !== "page"} />
        <TagChips narrow={layout !== "page"} />
      </div>
      <Notes beside={layout !== "page"} />
      <ListFooter />
    </aside>
  );
}
