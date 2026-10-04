import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";

const PAGE = 50;

type Search = {
  /** What the search box holds. */
  q: string;
  /** `q` once typing pauses: what the list is asked for. */
  asked: string;
  limit: number;
  filter: (next: string) => void;
  loadMore: () => void;
};

const SearchContext = createContext<Search | null>(null);

/**
 * The search in force. Everything that narrows the list (kind, author, tags, words) is one query
 * string, so a view is just that string saved under a name, and every control edits that string.
 */
export function SearchProvider({ children }: { children: ReactNode }) {
  const [q, setQ] = useState("");
  const [asked, setAsked] = useState("");
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => {
    const t = setTimeout(() => setAsked(q), 200);
    return () => clearTimeout(t);
  }, [q]);
  const value = useMemo(
    () => ({
      q,
      asked,
      limit,
      filter: (next: string) => {
        setQ(next);
        setLimit(PAGE);
      },
      loadMore: () => setLimit((l) => l + PAGE),
    }),
    [q, asked, limit],
  );
  return <SearchContext value={value}>{children}</SearchContext>;
}

export function useSearch() {
  const search = useContext(SearchContext);
  if (!search) throw new Error("useSearch outside SearchProvider");
  return search;
}
