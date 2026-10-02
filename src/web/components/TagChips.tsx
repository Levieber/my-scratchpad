import { useState } from "react";

import { hasToken, parseQuery, toggleToken } from "@/shared/query";
import type { Tag } from "@/web/lib/api";
import { chip, moreButton } from "@/web/lib/classes";
import { visibleTags } from "@/web/lib/listing";
import { cn } from "@/web/lib/utils";

const TAG_LIMIT = 8;

/** The tags as chips that toggle `#tag` in the search, so several tags combine. */
export function TagChips({
  tags,
  q,
  onFilter,
}: {
  tags: Tag[];
  q: string;
  onFilter: (next: string) => void;
}) {
  const [all, setAll] = useState(false);
  if (tags.length === 0) return null;
  const shown = all ? tags : visibleTags(tags, parseQuery(q).tags, TAG_LIMIT);
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((t) => (
        <button
          key={t.tag}
          className={cn(chip, "rounded-full px-2 py-0.5 text-xs")}
          aria-pressed={hasToken(q, `#${t.tag}`)}
          onClick={() => onFilter(toggleToken(q, `#${t.tag}`))}
        >
          #{t.tag} {t.count}
        </button>
      ))}
      {tags.length > TAG_LIMIT && (
        <button className={moreButton} aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? "Fewer tags" : `+${tags.length - shown.length} more`}
        </button>
      )}
    </div>
  );
}
