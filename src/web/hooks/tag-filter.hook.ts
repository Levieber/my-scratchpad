import { parseQuery, toggleToken } from "@/shared/query";
import { useSearch } from "@/web/hooks/search.hook";
import { toggled } from "@/web/lib/listing";

/**
 * The tags the search narrows to, and how a toggle group changes them: each press adds or removes
 * `#tag` in the search, so several tags combine and the query stays the one source.
 */
export function useTagFilter() {
  const { q, filter } = useSearch();
  const selected = parseQuery(q).tags;
  return {
    selected,
    onValueChange: (next: string[]) => {
      const tag = toggled(selected, next);
      if (tag) filter(toggleToken(q, `#${tag}`));
    },
  };
}
