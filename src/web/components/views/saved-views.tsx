import { useEffect, useRef, useState } from "react";

import { useViews } from "@/web/hooks/notes.hook";
import { useSearch } from "@/web/hooks/search.hook";
import { useViewMutations } from "@/web/hooks/views.hook";
import { field, moreButton } from "@/web/lib/classes";
import { cn } from "@/web/lib/utils";

// WCAG 2.2 target size: every control here is at least 24 x 24 px (min-h-6).
const pillButton = "min-h-6 border-0 bg-transparent py-0.5 text-xs text-muted-foreground";

const sameQuery = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Saved searches: apply one, delete one, or name the current search. Saving says whether the
 * name was taken, the one failure the person can fix, so the form stays open and says so.
 */
export function SavedViews() {
  const views = useViews();
  const { q, filter } = useSearch();
  const { save: saveView, remove } = useViewMutations();
  const [naming, setNaming] = useState<string | null>(null);
  const [nameTaken, setNameTaken] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  // Focus moves to the field once, when the person opens the form: not on every re-render, which
  // the 5 s poll would otherwise turn into stealing focus from the Save button.
  const formOpen = naming !== null;
  useEffect(() => {
    if (formOpen) nameRef.current?.focus();
  }, [formOpen]);

  const activeView = views.find((v) => sameQuery(v.query, q));
  if (views.length === 0 && !q.trim()) return null;

  const save = async (name: string) => {
    const result = await saveView(name);
    if (result === "saved") setNaming(null);
    else if (result === "taken") setNameTaken(true);
  };

  return (
    <fieldset className="flex flex-wrap items-center gap-1.5" aria-label="Saved views">
      {views.map((v) => (
        <span
          key={v.id}
          className="inline-flex items-center rounded-full border border-border data-[active=true]:border-primary data-[active=true]:bg-accent"
          data-active={activeView?.id === v.id}
        >
          <button
            className={cn(pillButton, "px-2 aria-pressed:text-foreground")}
            aria-pressed={activeView?.id === v.id}
            title={v.query}
            onClick={() => filter(activeView?.id === v.id ? "" : v.query)}
          >
            {v.name}
          </button>
          <button
            className={cn(pillButton, "min-w-6 px-1")}
            aria-label={`Delete view ${v.name}`}
            onClick={() => remove(v)}
          >
            ×
          </button>
        </span>
      ))}
      {q.trim() && !activeView && naming === null && (
        <button
          className={cn(moreButton, "min-h-6")}
          onClick={() => {
            setNameTaken(false);
            setNaming("");
          }}
        >
          Save this search
        </button>
      )}
      {naming !== null && (
        <form
          className="flex flex-wrap items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (naming.trim()) void save(naming.trim());
          }}
        >
          <input
            ref={nameRef}
            className={cn(field, "min-h-6 w-32 px-2 py-0.5")}
            aria-label="View name"
            aria-invalid={nameTaken}
            aria-describedby={nameTaken ? "view-name-error" : undefined}
            placeholder="Name this view"
            value={naming}
            onChange={(e) => {
              setNameTaken(false);
              setNaming(e.target.value);
            }}
            onKeyDown={(e) => e.key === "Escape" && setNaming(null)}
          />
          <button className={cn(moreButton, "min-h-6")}>Save</button>
          {nameTaken && (
            <span id="view-name-error" role="alert" className="basis-full text-xs text-destructive">
              A view with this name already exists
            </span>
          )}
        </form>
      )}
    </fieldset>
  );
}
