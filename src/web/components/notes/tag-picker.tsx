import { CheckIcon } from "lucide-react";
import { useState } from "react";

import { ChipButton } from "@/web/components/shell/chip";
import { ListMessage } from "@/web/components/shell/list-message";
import { Input } from "@/web/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/web/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/web/components/ui/toggle-group";
import { useTags } from "@/web/hooks/notes.hook";
import { useTagFilter } from "@/web/hooks/tag-filter.hook";
import { matchTags } from "@/web/lib/listing";

/**
 * Every tag, most used first, found by typing: a long tail of tags is a list to search, not a wall
 * of chips. Stays open while tags are picked, so several combine.
 */
export function TagPicker() {
  const tags = useTags();
  const { selected, onValueChange } = useTagFilter();
  const [text, setText] = useState("");
  const found = matchTags(tags, text);
  return (
    <Popover onOpenChange={() => setText("")}>
      <PopoverTrigger render={<ChipButton />}>All {tags.length} tags</PopoverTrigger>
      <PopoverContent align="start" className="gap-2 p-2">
        <Input
          type="search"
          aria-label="Find a tag"
          placeholder="Find a tag…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {found.length === 0 ? (
          <ListMessage render={<output />} className="block px-2 py-1.5">
            No tag holds “{text.trim()}”.
          </ListMessage>
        ) : (
          <ToggleGroup
            aria-label="All tags"
            multiple
            orientation="vertical"
            spacing={0.5}
            // Base UI marks the orientation as data-orientation, not the data-vertical shadcn's styles
            // read: the column is set here.
            className="max-h-72 w-full flex-col items-stretch overflow-y-auto"
            value={selected}
            onValueChange={onValueChange}
          >
            {found.map((t) => (
              <ToggleGroupItem
                key={t.tag}
                value={t.tag}
                size="sm"
                className="w-full justify-start gap-2 font-normal"
              >
                <CheckIcon className="invisible group-aria-pressed/toggle:visible" />
                <span className="min-w-0 flex-1 truncate text-left">#{t.tag}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{t.count}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      </PopoverContent>
    </Popover>
  );
}
