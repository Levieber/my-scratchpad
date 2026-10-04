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

/**
 * Where an agent is working: the repository's name, the folder inside it, the absolute folder,
 * and the home directory, which `~/` scopes are relative to.
 */
export type Location = { repo?: string; path?: string; dir?: string; home?: string };

/**
 * A scope is where a selection applies, as a string:
 * - `""`: everywhere;
 * - `my-scratchpad`, `my-scratchpad/apps/web`: a repository by name, or a folder inside it (the
 *   name is the same on every machine and in every clone or worktree);
 * - `~/work`: a folder in the home directory, and everything below it, repositories included
 *   (the same on every machine whatever the user's name or the system's home layout);
 * - `/srv/notes`: an absolute folder, for places outside the home directory (one machine's paths).
 *
 * Returns the scope in its one spelling, or undefined when it can't be one.
 */
export function normalizeScope(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const parts = trimmed.split("/").filter(Boolean);
  if (!parts.length || parts.some((p) => p === "." || p === "..")) return undefined;
  if (trimmed.startsWith("/")) return "/" + parts.join("/");
  if (parts[0] === "~") return parts.length > 1 ? parts.join("/") : undefined;
  // `~bob`: another user's home, which no hook knows.
  if (parts[0]!.startsWith("~")) return undefined;
  // Repository names compare without case, as the hosts that serve them do.
  return [parts[0]!.toLowerCase(), ...parts.slice(1)].join("/");
}

const within = (parent: string[], child: string[]) =>
  parent.length <= child.length && parent.every((p, i) => p === child[i]);

const segments = (path: string | undefined) => (path ?? "").split("/").filter(Boolean);

/** A folder scope as folders on disk at `at`; undefined for a `~/` scope when home is unknown. */
const folderOf = (scope: string, at: Location) =>
  scope.startsWith("~/")
    ? at.home === undefined
      ? undefined
      : [...segments(at.home), ...segments(scope.slice(2))]
    : segments(scope);

const isFolder = (scope: string) => scope.startsWith("/") || scope.startsWith("~/");

/** Whether a selection with `scope` (normalized) applies where the agent is. */
export function scopeMatches(scope: string, at: Location): boolean {
  if (!scope) return true;
  if (isFolder(scope)) {
    const folder = folderOf(scope, at);
    return folder !== undefined && at.dir !== undefined && within(folder, segments(at.dir));
  }
  const [repo, ...path] = segments(scope);
  return at.repo?.toLowerCase() === repo && within(path, segments(at.path));
}

/**
 * Sorts scopes that apply at `at` most specific first, with everywhere last. Depth is measured
 * in the folders on disk: a repository counts from where it is checked out, so a folder holding
 * many projects (`/home/me/work`) is broader than a repository inside it, and a folder inside
 * the repository is narrower.
 */
export const bySpecificity = (at: Location) => {
  const repoDepth = Math.max(0, segments(at.dir).length - segments(at.path).length);
  const depth = (scope: string) => {
    if (!scope) return -1;
    if (isFolder(scope)) return folderOf(scope, at)?.length ?? 0;
    return repoDepth + segments(scope).length - 1;
  };
  return (a: string, b: string) => depth(b) - depth(a) || a.localeCompare(b);
};

/**
 * The scope for where a command runs (`pad hooks … --here`): the repository, else the folder,
 * written from `~` when it is inside the home directory so it means the same on every machine.
 */
export function hereScope(at: Location): string {
  if (at.repo) return at.repo;
  if (!at.dir) return "";
  const home = segments(at.home);
  const dir = segments(at.dir);
  if (at.home && dir.length > home.length && within(home, dir))
    return ["~", ...dir.slice(home.length)].join("/");
  return at.dir;
}

/** A place where `scope` (normalized) applies: what a client asks about to preview a selection. */
export function scopeLocation(scope: string): Location {
  if (!scope) return {};
  // Any home will do for a preview: `~` itself stands in for it.
  if (scope.startsWith("~/")) return { home: "~", dir: scope };
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
