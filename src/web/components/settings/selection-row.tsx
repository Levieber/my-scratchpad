import { XIcon } from "lucide-react";
import { useState } from "react";

import type { HookName } from "@/shared/hooks";
import { useHookChoices, useHookSection } from "@/web/hooks/hooks-info.hook";
import { useOnline } from "@/web/hooks/online.hook";
import type { HookSelection, HooksInfo } from "@/web/lib/api";
import { button, field, ghostButton, iconButton, primaryButton } from "@/web/lib/classes";
import { refusal } from "@/web/lib/failures";
import { scopeLabel } from "@/web/lib/hooks";
import { ago } from "@/web/lib/listing";
import { cn } from "@/web/lib/utils";

/**
 * What a hook shows in one place: the search and limit, and the notes they give. Keyed by what
 * is stored, so a change (saved here or elsewhere) starts the form over from it.
 */
export function SelectionRow({
  hook,
  scope,
  stored,
  info,
}: {
  hook: HookName;
  scope: string;
  stored: HookSelection | undefined;
  info: HooksInfo["hooks"][number];
}) {
  const online = useOnline();
  const initialQuery = stored ? (stored.query ?? "") : scope ? "" : info.default.query;
  const initialLimit = String(stored?.limit ?? info.default.limit);
  const [query, setQuery] = useState(initialQuery);
  const [limit, setLimit] = useState(initialLimit);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const shown = useHookSection(hook, scope);
  const choices = useHookChoices(hook);

  const act = async (change: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await change();
    } catch (e) {
      setError(refusal(e));
    } finally {
      setBusy(false);
    }
  };

  const label = scopeLabel(scope);
  const dirty = query !== initialQuery || limit !== initialLimit;
  const errorId = `hook-${hook}-${scope || "everywhere"}-error`;
  const picked = new Set(shown?.include);

  return (
    <li className="flex flex-col gap-2 border-t border-border pt-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <h4 className="font-semibold wrap-anywhere">{label}</h4>
        <span className="text-xs text-muted-foreground">
          {stored ? `changed by ${stored.updated_by}, ${ago(stored.updated_at)}` : "default"}
        </span>
      </div>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void act(() =>
            choices.save({
              scope,
              query: query.trim() || null,
              limit: Number(limit),
            }),
          );
        }}
      >
        {/* Visible "Search" leads the name; the place, hidden, tells the rows apart. */}
        <label className="flex flex-[1_1_16rem] items-center gap-1.5 text-sm text-muted-foreground">
          Search<span className="sr-only"> for {label}</span>
          <input
            className={cn(field, "min-w-0 flex-1 text-foreground")}
            aria-describedby={error ? errorId : undefined}
            aria-invalid={Boolean(error)}
            placeholder="hand-picked notes only"
            value={query}
            disabled={!online}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          Limit
          <input
            className={cn(field, "w-20")}
            type="number"
            min={1}
            max={info.max_limit}
            value={limit}
            disabled={!online}
            onChange={(e) => setLimit(e.target.value)}
          />
        </label>
        <button className={primaryButton} disabled={!online || busy || !dirty}>
          Save
        </button>
        {stored && (
          <button
            type="button"
            className={button}
            disabled={!online || busy}
            onClick={() => void act(() => choices.reset(scope))}
          >
            {scope ? "Remove" : "Reset to default"}
          </button>
        )}
      </form>
      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="text-sm">
        <p className="text-xs text-muted-foreground">
          {shown?.notes.length
            ? `What agents see ${scope ? "here" : "everywhere"} (${shown.notes.length}):`
            : "No notes: this adds nothing."}
        </p>
        <ul>
          {shown?.notes.map((n) => (
            <li key={n.id} className="flex min-h-6 items-center gap-1">
              <span className="min-w-0 flex-1 truncate">{n.title}</span>
              {picked.has(n.id) && (
                <>
                  <span className="text-xs text-muted-foreground">hand-picked</span>
                  <button
                    className={cn(ghostButton, iconButton, "size-6 p-0")}
                    aria-label={`Stop hand-picking ${n.title}`}
                    disabled={!online || busy}
                    onClick={() => void act(() => choices.unpick(n.id, scope))}
                  >
                    <XIcon />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}
