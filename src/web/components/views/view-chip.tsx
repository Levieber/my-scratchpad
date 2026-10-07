import { XIcon } from "lucide-react";

import { Hint } from "@/web/components/shell/hint";
import { Button } from "@/web/components/ui/button";
import { useSearch } from "@/web/hooks/search.hook";
import { useActiveView, useViewMutations } from "@/web/hooks/views.hook";
import type { View } from "@/web/lib/api";
import { cn } from "@/web/lib/utils";

/** A saved view: pressed while its search is in force, and its delete button. */
export function ViewChip({ view: v }: { view: View }) {
  const { filter } = useSearch();
  const { remove } = useViewMutations();
  const active = useActiveView()?.id === v.id;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-border",
        active && "border-primary bg-accent",
      )}
    >
      <Hint label={v.query}>
        <Button
          variant="ghost"
          size="xs"
          className={cn(
            "rounded-full font-normal text-muted-foreground hover:bg-transparent",
            active && "text-foreground",
          )}
          aria-pressed={active}
          onClick={() => filter(active ? "" : v.query)}
        >
          {v.name}
        </Button>
      </Hint>
      <Hint label="Delete this view">
        <Button
          variant="ghost"
          size="icon-xs"
          className="rounded-full text-muted-foreground"
          aria-label={`Delete view ${v.name}`}
          onClick={() => remove(v)}
        >
          <XIcon />
        </Button>
      </Hint>
    </span>
  );
}
