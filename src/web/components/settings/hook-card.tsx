import type { HookName } from "@/shared/hooks";
import { AddScope } from "@/web/components/settings/add-scope";
import { SelectionRow } from "@/web/components/settings/selection-row";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/web/components/ui/card";
import type { HooksInfo } from "@/web/lib/api";

/** One agent hook: its choice for everywhere, one per repository or folder, and adding one. */
export function HookCard({ hook, name }: { hook: HooksInfo["hooks"][number]; name: HookName }) {
  const everywhere = hook.selections.find((s) => !s.scope);
  const scoped = hook.selections.filter((s) => s.scope);
  return (
    <article aria-labelledby={`hook-${name}`}>
      <Card size="sm">
        <CardHeader>
          <CardTitle className="font-mono font-semibold">
            <h3 id={`hook-${name}`}>{name}</h3>
          </CardTitle>
          <CardDescription>{hook.description}</CardDescription>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>
    </article>
  );
}
