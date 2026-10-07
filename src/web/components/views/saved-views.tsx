import { MoreViews } from "@/web/components/views/more-views";
import { NameView } from "@/web/components/views/name-view";
import { ViewChip } from "@/web/components/views/view-chip";
import { useViews } from "@/web/hooks/notes.hook";
import { useSearch } from "@/web/hooks/search.hook";
import { useActiveView } from "@/web/hooks/views.hook";
import { useWide } from "@/web/hooks/wide.hook";
import { visibleFirst } from "@/web/lib/listing";

/**
 * Saved searches: apply one, delete one, or name the current search. The first few show as chips
 * (the one in force always), the rest behind one more chip, so they never push the list away:
 * fewer on a phone and in the column beside a note (`narrow`).
 */
export function SavedViews({ narrow }: { narrow: boolean }) {
  const views = useViews();
  const { q } = useSearch();
  const activeView = useActiveView();
  const limit = useWide() && !narrow ? 6 : 3;
  if (views.length === 0 && !q.trim()) return null;
  const shown = visibleFirst(views, limit, (v) => v.id === activeView?.id);
  const hidden = views.filter((v) => !shown.includes(v));

  return (
    <fieldset className="flex flex-wrap items-center gap-1.5" aria-label="Saved views">
      {shown.map((v) => (
        <ViewChip key={v.id} view={v} />
      ))}
      {hidden.length > 0 && <MoreViews views={hidden} />}
      {q.trim() && !activeView && <NameView />}
    </fieldset>
  );
}
