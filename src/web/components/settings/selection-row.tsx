import { Field } from "@base-ui/react/field";
import { XIcon } from "lucide-react";
import { useState } from "react";

import type { HookName } from "@/shared/hooks";
import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";
import { useHookChoices, useHookSection } from "@/web/hooks/hooks-info.hook";
import { useOnline } from "@/web/hooks/online.hook";
import type { HookSelection, HooksInfo } from "@/web/lib/api";
import { refusal } from "@/web/lib/failures";
import { scopeLabel } from "@/web/lib/hooks";
import { ago } from "@/web/lib/listing";

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
        <Field.Root
          className="flex flex-[1_1_16rem] flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground"
          invalid={Boolean(error)}
        >
          <Field.Label>
            Search<span className="sr-only"> for {label}</span>
          </Field.Label>
          <Input
            className="w-auto flex-1"
            placeholder="hand-picked notes only"
            value={query}
            disabled={!online}
            onChange={(e) => setQuery(e.target.value)}
          />
          {error && (
            <Field.Error match className="basis-full text-xs text-destructive">
              {error}
            </Field.Error>
          )}
        </Field.Root>
        <Field.Root className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Field.Label>Limit</Field.Label>
          <Input
            className="w-20"
            type="number"
            min={1}
            max={info.max_limit}
            value={limit}
            disabled={!online}
            onChange={(e) => setLimit(e.target.value)}
          />
        </Field.Root>
        <Button type="submit" disabled={!online || busy || !dirty}>
          Save
        </Button>
        {stored && (
          <Button
            variant="outline"
            disabled={!online || busy}
            onClick={() => void act(() => choices.reset(scope))}
          >
            {scope ? "Remove" : "Reset to default"}
          </Button>
        )}
      </form>
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
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Stop hand-picking ${n.title}`}
                    disabled={!online || busy}
                    onClick={() => void act(() => choices.unpick(n.id, scope))}
                  >
                    <XIcon />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}
