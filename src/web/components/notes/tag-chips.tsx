import { useState } from "react";

import { parseQuery, toggleToken } from "@/shared/query";
import { Button } from "@/web/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/web/components/ui/toggle-group";
import { useTags } from "@/web/hooks/notes.hook";
import { useSearch } from "@/web/hooks/search.hook";
import { toggled, visibleTags } from "@/web/lib/listing";

const TAG_LIMIT = 8;

/** The tags as toggles that add or remove `#tag` in the search, so several tags combine. */
export function TagChips() {
  const tags = useTags();
  const { q, filter } = useSearch();
  const [all, setAll] = useState(false);
  if (tags.length === 0) return null;
  const selected = parseQuery(q).tags;
  const shown = all ? tags : visibleTags(tags, selected, TAG_LIMIT);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <ToggleGroup
        aria-label="Tags"
        multiple
        spacing={1.5}
        className="flex-wrap"
        value={selected}
        onValueChange={(next) => {
          const tag = toggled(selected, next);
          if (tag) filter(toggleToken(q, `#${tag}`));
        }}
      >
        {shown.map((t) => (
          <ToggleGroupItem
            key={t.tag}
            value={t.tag}
            variant="outline"
            className="h-6 min-w-6 rounded-full px-2 text-xs text-muted-foreground aria-pressed:border-primary aria-pressed:bg-accent aria-pressed:text-foreground"
          >
            #{t.tag} {t.count}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {tags.length > TAG_LIMIT && (
        <Button
          variant="outline"
          size="xs"
          className="border-dashed text-muted-foreground"
          aria-expanded={all}
          onClick={() => setAll(!all)}
        >
          {all ? "Fewer tags" : `+${tags.length - shown.length} more`}
        </Button>
      )}
    </div>
  );
}
