import { useEffect, useRef } from "react";

import { ChipButton } from "@/web/components/shell/chip";
import { ListMessage } from "@/web/components/shell/list-message";
import type { Listed } from "@/web/hooks/listed.hook";

/**
 * Below any layout: why it is empty, or more to load. The next page loads by itself as the end of
 * the list nears (a screenful early); the button stays for the keyboard, and where it doesn't.
 */
export function ListEnd({ listed }: { listed: Listed }) {
  const { top, rest, searching, canLoadMore, loadMore, loading } = listed;
  const more = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = more.current;
    if (!canLoadMore || !el) return;
    // The list scrolls inside its own area; the page itself doesn't.
    const root = el.closest("nav");
    const seen = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) loadMore();
      },
      { root, rootMargin: "0px 0px 100% 0px" },
    );
    seen.observe(el);
    return () => seen.disconnect();
  }, [canLoadMore, loadMore]);
  return (
    <>
      {rest.length === 0 && top.length === 0 && !loading && (
        <ListMessage>{searching ? "No matches." : "No notes yet."}</ListMessage>
      )}
      {/* Always there, so a screen reader hears it fill; it takes room only when it says something. */}
      <output className="block text-center text-xs text-muted-foreground not-empty:p-2.5">
        {loading ? "Loading…" : ""}
      </output>
      {canLoadMore && (
        <ChipButton ref={more} className="mx-auto my-2 flex" onClick={loadMore}>
          Load more
        </ChipButton>
      )}
    </>
  );
}
