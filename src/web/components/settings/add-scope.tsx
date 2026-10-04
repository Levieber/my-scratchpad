import { Field } from "@base-ui/react/field";
import { useState } from "react";

import { type HookName, normalizeScope } from "@/shared/hooks";
import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";
import { useHookChoices } from "@/web/hooks/hooks-info.hook";
import { useOnline } from "@/web/hooks/online.hook";
import { refusal } from "@/web/lib/failures";

const addField = "flex flex-[1_1_12rem] flex-col gap-1 text-xs text-muted-foreground";

/** A choice for one more place: a repository, a folder in it, or a folder outside any. */
export function AddScope({ hook }: { hook: HookName }) {
  const online = useOnline();
  const choices = useHookChoices(hook);
  const [scope, setScope] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  return (
    <form
      className="flex flex-wrap items-start gap-2 border-t border-border pt-3 [&>button]:mt-5.5"
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
      <Field.Root className={addField} invalid={Boolean(error)}>
        <Field.Label>Repository or folder</Field.Label>
        <Input
          placeholder="my-repo, my-repo/folder, ~/work or /absolute/folder"
          value={scope}
          disabled={!online}
          onChange={(e) => {
            setError("");
            setScope(e.target.value);
          }}
        />
        {error && (
          <Field.Error match className="text-xs text-destructive">
            {error}
          </Field.Error>
        )}
      </Field.Root>
      <Field.Root className={addField}>
        <Field.Label>Search</Field.Label>
        <Input
          placeholder="e.g. #my-repo"
          value={query}
          disabled={!online}
          onChange={(e) => setQuery(e.target.value)}
        />
      </Field.Root>
      <Button type="submit" variant="outline" disabled={!online || !scope.trim()}>
        Add
      </Button>
    </form>
  );
}
