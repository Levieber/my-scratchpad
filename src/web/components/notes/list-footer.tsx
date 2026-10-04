import { PAGES } from "@/shared/pages";
import { Button } from "@/web/components/ui/button";
import { useOnline } from "@/web/hooks/online.hook";
import { usePending } from "@/web/hooks/pending.hook";
import { go } from "@/web/hooks/route.hook";
import { useSearch } from "@/web/hooks/search.hook";
import { useExport, useImportLimits } from "@/web/hooks/transfer.hook";
import { cn } from "@/web/lib/utils";

/** The connection, what is waiting to sync, and the links out of the list. */
export function ListFooter() {
  const online = useOnline();
  const pending = usePending().length;
  const { asked } = useSearch();
  const { exporting, exportNotes } = useExport();
  const canExport = useImportLimits() !== null;
  return (
    <footer className="flex justify-between gap-2 text-xs text-muted-foreground">
      <output>
        <span
          aria-hidden="true"
          className={cn("mr-1", online ? "text-success" : "text-destructive")}
        >
          ●
        </span>
        {online ? "online" : "offline"}
        {pending > 0 && ` · ${pending} ${pending === 1 ? "change" : "changes"} to sync`}
      </output>
      <span className="flex gap-1">
        {canExport && (
          // What the list shows, as a file: the search in force, or everything without one.
          <Button
            variant="link"
            size="xs"
            className="px-1 font-normal text-muted-foreground underline"
            disabled={!online || exporting}
            onClick={() => exportNotes(asked, true)}
          >
            {asked.trim() ? "Export these" : "Export all"}
          </Button>
        )}
        {/* A real link, so it opens in a new tab too; a plain click stays in the app. */}
        <a
          className="inline-flex min-h-6 min-w-6 items-center px-1 underline"
          href={PAGES.settings}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            go("settings");
          }}
        >
          Settings
        </a>
        <a
          className="inline-flex min-h-6 min-w-6 items-center px-1 underline"
          href="/openapi.json"
          target="_blank"
        >
          API
        </a>
      </span>
    </footer>
  );
}
