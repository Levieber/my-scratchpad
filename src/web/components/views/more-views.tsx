import { ChipButton } from "@/web/components/shell/chip";
import { Popover, PopoverContent, PopoverTrigger } from "@/web/components/ui/popover";
import { ViewChip } from "@/web/components/views/view-chip";
import type { View } from "@/web/lib/api";

/** The saved views past the first few, as the same chips, one press away. */
export function MoreViews({ views }: { views: View[] }) {
  return (
    <Popover>
      <PopoverTrigger render={<ChipButton />}>
        +{views.length} {views.length === 1 ? "view" : "views"}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <fieldset
          aria-label="More saved views"
          className="flex max-h-72 flex-wrap gap-1.5 overflow-y-auto"
        >
          {views.map((v) => (
            <ViewChip key={v.id} view={v} />
          ))}
        </fieldset>
      </PopoverContent>
    </Popover>
  );
}
