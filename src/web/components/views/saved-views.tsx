import { Field } from "@base-ui/react/field";
import { XIcon } from "lucide-react";
import { useState } from "react";

import { Hint } from "@/web/components/shell/hint";
import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/web/components/ui/popover";
import { usePickedFor } from "@/web/hooks/layout.hook";
import { useViews } from "@/web/hooks/notes.hook";
import { useSearch } from "@/web/hooks/search.hook";
import { useActiveView, useViewMutations } from "@/web/hooks/views.hook";
import { cn } from "@/web/lib/utils";

/** Saved searches: apply one, delete one, or name the current search. */
export function SavedViews() {
  const views = useViews();
  const { q, filter } = useSearch();
  const { remove } = useViewMutations();
  const activeView = useActiveView();
  if (views.length === 0 && !q.trim()) return null;

  return (
    <fieldset className="flex flex-wrap items-center gap-1.5" aria-label="Saved views">
      {views.map((v) => {
        const active = activeView?.id === v.id;
        return (
          <span
            key={v.id}
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
            <Button
              variant="ghost"
              size="icon-xs"
              className="rounded-full text-muted-foreground"
              aria-label={`Delete view ${v.name}`}
              onClick={() => remove(v)}
            >
              <XIcon />
            </Button>
          </span>
        );
      })}
      {q.trim() && !activeView && <NameView />}
    </fieldset>
  );
}

/**
 * Names the search in force. A name already taken is the one failure the person can fix, so the
 * popover stays open and says so.
 */
function NameView() {
  const { save } = useViewMutations();
  const how = usePickedFor();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [taken, setTaken] = useState(false);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setName("");
        setTaken(false);
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="xs"
            className="border-dashed font-normal text-muted-foreground"
          />
        }
      >
        Save this search
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 max-w-[calc(100vw-2rem)]">
        <form
          className="flex flex-col gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            const result = await save(name.trim(), how);
            if (result === "saved") setOpen(false);
            else if (result === "taken") setTaken(true);
          }}
        >
          <Field.Root className="flex flex-col gap-1.5" invalid={taken}>
            <Field.Label className="text-xs font-medium">View name</Field.Label>
            <Input
              placeholder="Name this view"
              value={name}
              onChange={(e) => {
                setTaken(false);
                setName(e.target.value);
              }}
            />
            {taken && (
              <Field.Error match className="text-xs text-destructive">
                A view with this name already exists
              </Field.Error>
            )}
          </Field.Root>
          <Button type="submit" size="sm" className="self-end">
            Save
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
