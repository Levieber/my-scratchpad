import type { HookName } from "@/shared/hooks";
import { AddScope } from "@/web/components/settings/add-scope";
import { SelectionRow } from "@/web/components/settings/selection-row";
import type { HooksInfo } from "@/web/lib/api";

/** One agent hook: its choice for everywhere, one per repository or folder, and adding one. */
export function HookCard({ hook, name }: { hook: HooksInfo["hooks"][number]; name: HookName }) {
  const everywhere = hook.selections.find((s) => !s.scope);
  const scoped = hook.selections.filter((s) => s.scope);
  return (
    <article
      aria-labelledby={`hook-${name}`}
      className="flex flex-col gap-3 rounded-card border border-border bg-card p-4 max-wide:p-3"
    >
      <div>
        <h3 id={`hook-${name}`} className="font-mono text-sm font-semibold">
          {name}
        </h3>
        <p className="text-sm text-muted-foreground">{hook.description}</p>
      </div>
      <ul className="flex flex-col gap-4">
        <SelectionRow
          key={everywhere?.updated_at ?? "default"}
          hook={name}
          scope=""
          stored={everywhere}
          info={hook}
        />
        {scoped.map((s) => (
          <SelectionRow
            key={`${s.scope} ${s.updated_at}`}
            hook={name}
            scope={s.scope}
            stored={s}
            info={hook}
          />
        ))}
      </ul>
      <AddScope hook={name} />
    </article>
  );
}
