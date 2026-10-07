import { operatorValue, setOperator } from "@/shared/query";
import { ChipToggle } from "@/web/components/shell/chip";
import { ToggleGroup } from "@/web/components/ui/toggle-group";
import { useSearch } from "@/web/hooks/search.hook";
import { toggled } from "@/web/lib/listing";

// Each item is an operator and the value it sets: "kind:" is any kind.
const ITEMS = [
  ["kind", "", "All"],
  ["kind", "note", "Notes"],
  ["kind", "reference", "Reference"],
  ["author", "", "Anyone"],
  ["author", "human", "Me"],
  ["author", "agent", "Agents"],
] as const;

/**
 * The kind and author filters: one toggle group, so one tab stop and arrow keys between them.
 * Each half works like a radio (one kind, one author), and edits the search box, so the query
 * stays the one source.
 */
export function Filters() {
  const { q, filter } = useSearch();
  const pressed = [`kind:${operatorValue(q, "kind")}`, `author:${operatorValue(q, "author")}`];
  return (
    <ToggleGroup
      aria-label="Filters"
      multiple
      spacing={1}
      className="flex-wrap"
      value={pressed}
      onValueChange={(next) => {
        const item = toggled(pressed, next);
        // Pressing the one already pressed changes nothing: some kind is always chosen.
        if (!item || !next.includes(item)) return;
        const [operator, value] = item.split(":") as ["kind" | "author", string];
        filter(setOperator(q, operator, value));
      }}
    >
      {ITEMS.map(([operator, value, label], i) => (
        <ChipToggle
          key={`${operator}:${value}`}
          value={`${operator}:${value}`}
          size="md"
          // The two halves read apart: a gap before the first author.
          className="data-first-author:ml-2.5"
          data-first-author={i === 3 || undefined}
        >
          {label}
        </ChipToggle>
      ))}
    </ToggleGroup>
  );
}
