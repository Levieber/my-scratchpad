import { PAGES } from "@/shared/pages";
import { QuietLink, QuietLinkButton } from "@/web/components/shell/quiet";
import { ThemeSwitcher } from "@/web/components/shell/theme-switcher";
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
    <footer className="flex aligned-column flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <output>
        <span
          aria-hidden="true"
          className={cn(
            "mr-1.5 inline-block size-1.5 rounded-full align-middle",
            online ? "bg-success" : "bg-destructive",
          )}
        />
        {online ? "online" : "offline"}
        {pending > 0 && ` · ${pending} ${pending === 1 ? "change" : "changes"} to sync`}
      </output>
      <ThemeSwitcher className="ml-auto" />
      <span className="flex gap-2.5">
        {canExport && (
          // What the list shows, as a file: the search in force, or everything without one.
          <QuietLinkButton disabled={!online || exporting} onClick={() => exportNotes(asked, true)}>
            {asked.trim() ? "Export these" : "Export all"}
          </QuietLinkButton>
        )}
        {/* A real link, so it opens in a new tab too; a plain click stays in the app. */}
        <QuietLink
          href={PAGES.settings}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            go("settings");
          }}
        >
          Settings
        </QuietLink>
        <QuietLink href="/openapi.json" target="_blank">
          API
        </QuietLink>
      </span>
    </footer>
  );
}
