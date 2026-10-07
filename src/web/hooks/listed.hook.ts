import { operatorValue } from "@/shared/query";
import { useEditor } from "@/web/hooks/editor.hook";
import { useNotes, usePins } from "@/web/hooks/notes.hook";
import { useSearch } from "@/web/hooks/search.hook";

/**
 * What every layout shows for the search in force. Unless searching, the pinned notes come
 * first (`top`) and aren't in `rest` again.
 */
export function useListed() {
  const { q, asked, limit, loadMore } = useSearch();
  const { notes, canLoadMore, loading } = useNotes(asked, limit);
  const pinned = usePins();
  const currentId = useEditor().current?.id;
  const searching = q !== "";
  const top = searching ? [] : pinned;
  const isTop = new Set(top.map((n) => n.id));
  return {
    top,
    rest: notes.filter((n) => !isTop.has(n.id)),
    searching,
    canLoadMore,
    loadMore,
    /** A new search, or the next page of this one, is on its way. */
    loading,
    currentId,
    /** The kind filter in force, so it isn't repeated on every note. */
    kind: operatorValue(q, "kind"),
  };
}

export type Listed = ReturnType<typeof useListed>;
