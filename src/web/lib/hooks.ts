// Hand-picking notes for the agent hooks from the PWA: whether a note can be picked right now,
// and the hint that says why not. The list's menu picks for everywhere; Settings handles the rest.
import type { HooksInfo } from "@/shared/domain";
import type { HookName } from "@/shared/hooks";

export type PickState = { picked: boolean; disabled: boolean; hint: string };

/** The notes hand-picked for `hook` where `scope` applies (everywhere by default). */
export const pickedIds = (info: HooksInfo | null, hook: HookName, scope = "") =>
  new Set(
    info?.hooks.find((h) => h.name === hook)?.selections.find((s) => s.scope === scope)?.include,
  );

const WHAT: Record<HookName, string> = {
  "session-start": "Its title opens every agent session",
  review: "Agents check their edits against it",
};

export function pickState(
  id: string,
  hook: HookName,
  info: HooksInfo | null,
  /** Notes made here that the server hasn't seen: it can't pick what it doesn't have. */
  unsyncedIds: ReadonlySet<string>,
): PickState {
  const picked = pickedIds(info, hook);
  if (picked.has(id)) return { picked: true, disabled: false, hint: "Stop showing it to agents" };
  if (unsyncedIds.has(id))
    return { picked: false, disabled: true, hint: "Agents can see it once the note has synced" };
  if (info && picked.size >= info.max_include)
    return {
      picked: false,
      disabled: true,
      hint: `${info.max_include} notes are hand-picked already: remove one in Settings`,
    };
  return { picked: false, disabled: false, hint: WHAT[hook] };
}

/** Where a choice applies, for people. */
export const scopeLabel = (scope: string) =>
  !scope ? "Everywhere" : scope.startsWith("/") ? `Folder ${scope}` : scope;
