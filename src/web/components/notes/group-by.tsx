import { Field } from "@base-ui/react/field";
import { useState } from "react";

import type { GroupBy } from "@/shared/layouts";
import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/web/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/web/components/ui/toggle-group";
import { DEFAULT_GROUP_BY } from "@/web/lib/board";

const MODES = [
  ["prefix", "Tag prefix"],
  ["tags", "Tags"],
  ["checklist", "Checklist"],
] as const;

const list = (text: string) => [
  ...new Set(
    text
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean),
  ),
];

export const describeGroupBy = (g: GroupBy) =>
  g.by === "prefix" ? `${g.prefix}…` : g.by === "tags" ? g.tags.join(", ") : "checklist";

/** Choosing a board's columns: a tag prefix and its first columns, a list of tags, or the checklist. */
export function GroupByPicker({
  value,
  onChange,
}: {
  value: GroupBy;
  onChange: (next: GroupBy) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<GroupBy["by"]>(value.by);
  // Starting another kind of grouping from the default's prefix and columns.
  const start = value.by === "prefix" ? value : DEFAULT_GROUP_BY;
  const [prefix, setPrefix] = useState(start.prefix);
  const [columns, setColumns] = useState((start.columns ?? []).join(", "));
  const [tags, setTags] = useState(value.by === "tags" ? value.tags.join(", ") : "");
  const next = (): GroupBy | null => {
    if (mode === "checklist") return { by: "checklist" };
    if (mode === "tags") return list(tags).length ? { by: "tags", tags: list(tags) } : null;
    const p = prefix.trim().toLowerCase();
    return p ? { by: "prefix", prefix: p, columns: list(columns) } : null;
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" size="xs" className="font-normal text-muted-foreground" />
        }
      >
        Columns: {describeGroupBy(value)}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 max-w-[calc(100vw-2rem)]">
        <form
          className="flex flex-col gap-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            const chosen = next();
            if (!chosen) return;
            onChange(chosen);
            setOpen(false);
          }}
        >
          <ToggleGroup
            aria-label="Columns from"
            variant="outline"
            size="sm"
            spacing={0}
            value={[mode]}
            onValueChange={(v) => {
              const picked = v.find((m) => m !== mode);
              if (picked) setMode(picked as GroupBy["by"]);
            }}
          >
            {MODES.map(([key, label]) => (
              <ToggleGroupItem
                key={key}
                value={key}
                className="h-8 px-2.5 text-xs aria-pressed:bg-accent"
              >
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {mode === "prefix" && (
            <>
              <Field.Root className="flex flex-col gap-1">
                <Field.Label className="text-xs font-medium">Tags starting with</Field.Label>
                <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} />
              </Field.Root>
              <Field.Root className="flex flex-col gap-1">
                <Field.Label className="text-xs font-medium">First columns, in order</Field.Label>
                <Input
                  value={columns}
                  placeholder="todo, doing, done"
                  onChange={(e) => setColumns(e.target.value)}
                />
              </Field.Root>
            </>
          )}
          {mode === "tags" && (
            <Field.Root className="flex flex-col gap-1">
              <Field.Label className="text-xs font-medium">A column per tag, in order</Field.Label>
              <Input
                value={tags}
                placeholder="urgent, later"
                onChange={(e) => setTags(e.target.value)}
              />
            </Field.Root>
          )}
          {mode === "checklist" && (
            <p className="text-xs text-muted-foreground">
              No tasks, to do, under way, done: read from each note's checkboxes, so notes move by
              ticking them.
            </p>
          )}
          <Button type="submit" size="sm" className="self-end" disabled={!next()}>
            Show
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
