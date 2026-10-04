import { useState } from "react";

import { type HookName, normalizeScope } from "@/shared/hooks";
import { useHookChoices } from "@/web/hooks/hooks-info.hook";
import { useOnline } from "@/web/hooks/online.hook";
import { button, field } from "@/web/lib/classes";
import { refusal } from "@/web/lib/failures";
import { cn } from "@/web/lib/utils";

const addLabel = "flex flex-[1_1_12rem] flex-col gap-1 text-xs text-muted-foreground";

/** A choice for one more place: a repository, a folder in it, or a folder outside any. */
export function AddScope({ hook }: { hook: HookName }) {
  const online = useOnline();
  const choices = useHookChoices(hook);
  const [scope, setScope] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const errorId = `hook-${hook}-add-error`;

  return (
    <form
      className="flex flex-wrap items-end gap-2 border-t border-border pt-3"
      aria-label={`Choose notes for a repository or folder (${hook})`}
      onSubmit={async (e) => {
        e.preventDefault();
        const normalized = normalizeScope(scope);
        if (!normalized) {
          setError("Name a repository, a repository/folder, a ~/folder or an /absolute/folder.");
          return;
        }
        try {
          await choices.save({ scope: normalized, query: query.trim() || null });
          setScope("");
          setQuery("");
          setError("");
        } catch (err) {
          setError(refusal(err));
        }
      }}
    >
      <label className={addLabel}>
        Repository or folder
        <input
          className={cn(field, "text-base text-foreground")}
          aria-describedby={error ? errorId : undefined}
          aria-invalid={Boolean(error)}
          placeholder="my-repo, my-repo/folder, ~/work or /absolute/folder"
          value={scope}
          disabled={!online}
          onChange={(e) => {
            setError("");
            setScope(e.target.value);
          }}
        />
      </label>
      <label className={addLabel}>
        Search
        <input
          className={cn(field, "text-base text-foreground")}
          placeholder="e.g. #my-repo"
          value={query}
          disabled={!online}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <button className={cn(button, "h-10.5")} disabled={!online || !scope.trim()}>
        Add
      </button>
      {error && (
        <p id={errorId} role="alert" className="basis-full text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
