import { LayoutGridIcon, ListIcon, type LucideIcon, Table2Icon } from "lucide-react";

import { isLayout, type Layout, LAYOUTS } from "@/shared/layouts";
import { Hint } from "@/web/components/shell/hint";
import { ToggleGroup, ToggleGroupItem } from "@/web/components/ui/toggle-group";
import { useChooseLayout, useLayout } from "@/web/hooks/layout.hook";

const ICONS: Record<Layout, LucideIcon> = {
  list: ListIcon,
  grid: LayoutGridIcon,
  table: Table2Icon,
};

/**
 * How the search in force is shown: every layout this app knows (shared/layouts.ts), as a radio
 * group (one tab stop, arrow keys inside).
 */
export function LayoutPicker() {
  const { layout } = useLayout();
  const choose = useChooseLayout();
  return (
    <ToggleGroup
      aria-label="Layout"
      variant="outline"
      size="sm"
      spacing={0}
      className="flex-none"
      value={[layout]}
      onValueChange={(next) => {
        // Pressing the one already pressed releases it; some layout is always shown.
        const picked = next.find((v) => v !== layout);
        if (isLayout(picked)) choose(picked);
      }}
    >
      {LAYOUTS.map(({ key, label }) => {
        const Icon = ICONS[key];
        return (
          <Hint key={key} label={label}>
            <ToggleGroupItem
              value={key}
              aria-label={label}
              className="h-9 px-2.5 text-muted-foreground aria-pressed:bg-accent aria-pressed:text-foreground"
            >
              <Icon />
            </ToggleGroupItem>
          </Hint>
        );
      })}
    </ToggleGroup>
  );
}
