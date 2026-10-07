import { TagPicker } from "@/web/components/notes/tag-picker";
import { ChipToggle } from "@/web/components/shell/chip";
import { ToggleGroup } from "@/web/components/ui/toggle-group";
import { useTags } from "@/web/hooks/notes.hook";
import { useTagFilter } from "@/web/hooks/tag-filter.hook";
import { useWide } from "@/web/hooks/wide.hook";
import { visibleFirst } from "@/web/lib/listing";

/**
 * The most used tags as chips, and the selected ones wherever they rank; every tag is one search
 * away in the picker. A phone, or the column beside a note (`narrow`), shows fewer, so the list
 * keeps the screen.
 */
export function TagChips({ narrow }: { narrow: boolean }) {
  const tags = useTags();
  const { selected, onValueChange } = useTagFilter();
  const limit = useWide() && !narrow ? 8 : 4;
  if (tags.length === 0) return null;
  const shown = visibleFirst(tags, limit, (t) => selected.includes(t.tag));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <ToggleGroup
        aria-label="Tags"
        multiple
        spacing={1.5}
        className="flex-wrap"
        value={selected}
        onValueChange={onValueChange}
      >
        {shown.map((t) => (
          <ChipToggle key={t.tag} value={t.tag}>
            #{t.tag}
            <span className="text-muted-foreground tabular-nums">{t.count}</span>
          </ChipToggle>
        ))}
      </ToggleGroup>
      {tags.length > shown.length && <TagPicker />}
    </div>
  );
}
