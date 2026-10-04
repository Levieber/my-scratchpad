import { Button } from "@/web/components/ui/button";
import type { Listed } from "@/web/hooks/listed.hook";

/** Below any layout: why it is empty, or more to load. */
export function ListEnd({ listed }: { listed: Listed }) {
  const { top, rest, searching, canLoadMore, loadMore } = listed;
  return (
    <>
      {rest.length === 0 && top.length === 0 && (
        <p className="p-2.5 text-xs text-muted-foreground">
          {searching ? "No matches." : "No notes yet."}
        </p>
      )}
      {canLoadMore && (
        <Button
          variant="outline"
          size="xs"
          className="mx-auto my-2 flex border-dashed text-muted-foreground"
          onClick={loadMore}
        >
          Load more
        </Button>
      )}
    </>
  );
}
