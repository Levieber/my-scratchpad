/**
 * The agent hooks that put notes in front of an agent, and where a choice of notes applies. Each
 * hook has a default search; the user's selections replace or add to it, per place: everywhere,
 * one repository, a folder inside it, or a folder outside any repository. A declared list, so a
 * new hook is one more entry and readers skip names they don't know.
 */
export const HOOKS = {
  "session-start": {
    description: "Notes whose titles open every session",
    query: "kind:note",
    limit: 8,
    maxLimit: 30,
  },
  review: {
    description: "Reference notes the end-of-turn review checks edits against",
    query: "kind:reference",
    limit: 100,
    maxLimit: 200,
  },
} as const satisfies Record<
  string,
  { description: string; query: string; limit: number; maxLimit: number }
>;

export type HookName = keyof typeof HOOKS;

export const HOOK_NAMES = Object.keys(HOOKS) as HookName[];

export const isHookName = (value: unknown): value is HookName =>
  typeof value === "string" && Object.hasOwn(HOOKS, value);

/** How many notes one selection may pick by hand: they show in every session, so few. */
export const MAX_INCLUDE = 20;

/** Where an agent is working: the repository's name, the folder inside it, the absolute folder. */
export type Location = { repo?: string; path?: string; dir?: string };

/**
 * A scope is where a selection applies, as a string:
 * - `""`: everywhere;
 * - `my-scratchpad`, `my-scratchpad/apps/web`: a repository by name, or a folder inside it (the
 *   name is the same on every machine and in every clone or worktree);
 * - `/home/me/notes`: an absolute folder, for work outside a repository (one machine's paths).
 *
 * Returns the scope in its one spelling, or undefined when it can't be one.
 */
export function normalizeScope(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const absolute = trimmed.startsWith("/");
  const parts = trimmed.split("/").filter(Boolean);
  if (!parts.length || parts.some((p) => p === "." || p === "..")) return undefined;
  if (absolute) return "/" + parts.join("/");
  // Repository names compare without case, as the hosts that serve them do.
  return [parts[0]!.toLowerCase(), ...parts.slice(1)].join("/");
}

const within = (parent: string[], child: string[]) =>
  parent.length <= child.length && parent.every((p, i) => p === child[i]);

const segments = (path: string | undefined) => (path ?? "").split("/").filter(Boolean);

/** Whether a selection with `scope` (normalized) applies where the agent is. */
export function scopeMatches(scope: string, at: Location): boolean {
  if (!scope) return true;
  if (scope.startsWith("/"))
    return at.dir !== undefined && within(segments(scope), segments(at.dir));
  const [repo, ...path] = segments(scope);
  return at.repo?.toLowerCase() === repo && within(path, segments(at.path));
}

/** Sorts scopes most specific first (the deepest folder), with everywhere last. */
export const bySpecificity = (a: string, b: string) =>
  segments(b).length - segments(a).length || a.localeCompare(b);

/** A place where `scope` (normalized) applies: what a client asks about to preview a selection. */
export function scopeLocation(scope: string): Location {
  if (!scope) return {};
  if (scope.startsWith("/")) return { dir: scope };
  const [repo, ...path] = segments(scope);
  return { repo, path: path.join("/") };
}

/**
 * A repository's name: the last part of its `origin` remote (`git@host:me/pad.git`,
 * `https://host/me/pad`), else its top-level folder's. The remote comes first because a worktree
 * or a second clone lives in a folder of another name.
 */
export function repoName(remote: string | undefined, toplevel: string): string {
  const last = (s: string) => segments(s.replace(/:/g, "/")).at(-1) ?? "";
  const fromRemote = remote ? last(remote).replace(/\.git$/, "") : "";
  return (fromRemote || last(toplevel)).toLowerCase();
}
