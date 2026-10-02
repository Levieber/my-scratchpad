import { useEffect, useRef, useState } from "react";

import type { View } from "@/web/lib/api";

const sameQuery = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Saved searches: apply one, delete one, or name the current search. `onSave` says whether the
 * name was taken, the one failure the person can fix, so the form stays open and says so.
 */
export function SavedViews({
  views,
  q,
  onFilter,
  onSave,
  onRemove,
}: {
  views: View[];
  q: string;
  onFilter: (next: string) => void;
  onSave: (name: string) => Promise<"saved" | "taken" | "failed">;
  onRemove: (view: View) => void;
}) {
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
    const result = await onSave(name);
    if (result === "saved") setNaming(null);
    else if (result === "taken") setNameTaken(true);
  };

  return (
    <fieldset className="tags views" aria-label="Saved views">
      {views.map((v) => (
        <span key={v.id} className="view" data-active={activeView?.id === v.id}>
          <button
            className="apply"
            aria-pressed={activeView?.id === v.id}
            title={v.query}
            onClick={() => onFilter(activeView?.id === v.id ? "" : v.query)}
          >
            {v.name}
          </button>
          <button
            className="remove"
            aria-label={`Delete view ${v.name}`}
            onClick={() => onRemove(v)}
          >
            ×
          </button>
        </span>
      ))}
      {q.trim() && !activeView && naming === null && (
        <button
          className="more"
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
          onSubmit={(e) => {
            e.preventDefault();
            if (naming.trim()) void save(naming.trim());
          }}
        >
          <input
            ref={nameRef}
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
          <button className="more">Save</button>
          {nameTaken && (
            <span id="view-name-error" role="alert" className="error">
              A view with this name already exists
            </span>
          )}
        </form>
      )}
    </fieldset>
  );
}
