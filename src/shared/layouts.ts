// How a search's notes can be shown, declared once for the API, the CLI and the PWA. Here rather
// than in domain.ts so the PWA can read it without loading Effect; each layout's options schema is
// in domain.ts (LAYOUT_OPTIONS), keyed by the same names.
//
// Additive only, like the markdown dialect: a new layout, or a new option for one, gets the next
// LAYOUTS_VERSION. Renaming a layout or changing what an option means is a breaking change.

export const LAYOUTS_VERSION = 1;

/** Every layout, in the order a picker shows them. `since` is the LAYOUTS_VERSION that added it. */
export const LAYOUTS = [
  { key: "list", label: "List", since: 1 },
  { key: "grid", label: "Grid", since: 1 },
  { key: "table", label: "Table", since: 1 },
  { key: "board", label: "Board", since: 1 },
  { key: "pages", label: "Pages", since: 1 },
] as const;

export type Layout = (typeof LAYOUTS)[number]["key"];

export const LAYOUT_KEYS: readonly Layout[] = LAYOUTS.map((l) => l.key);

/** What a client shows when nothing (no view, no preference) chose a layout. */
export const DEFAULT_LAYOUT: Layout = "list";

export const isLayout = (value: unknown): value is Layout =>
  typeof value === "string" && (LAYOUT_KEYS as readonly string[]).includes(value);

/**
 * The layout a client shows for `chosen` (a view's layout, null when it has none): the
 * preference when nothing was chosen, and the list when it was chosen by a newer app this one
 * doesn't know. `unknown` says so, for a client to tell the person it needs a newer app.
 */
export function shownLayout(
  chosen: string | null | undefined,
  preference: Layout = DEFAULT_LAYOUT,
): { layout: Layout; unknown?: string } {
  if (chosen == null) return { layout: preference };
  return isLayout(chosen) ? { layout: chosen } : { layout: "list", unknown: chosen };
}

/** The table's columns, which are also what it sorts by (`options.sort.by`). */
export const TABLE_COLUMNS = ["title", "kind", "tags", "author", "progress", "updated"] as const;

export type TableColumn = (typeof TABLE_COLUMNS)[number];

/** How a board makes its columns (`options.groupBy`); see web/lib/board.ts. */
export type GroupBy =
  /** A column per value of the tags starting with `prefix` (`status:todo`), `columns` first. */
  | { by: "prefix"; prefix: string; columns?: readonly string[] }
  /** A column per tag, in this order. */
  | { by: "tags"; tags: readonly string[] }
  /** By the note's checklist: no tasks, to do, under way, done. Read from the body, so fixed. */
  | { by: "checklist" };

/**
 * `patch` applied to `target` as a JSON Merge Patch (RFC 7396): objects merge key by key, null
 * removes a key, anything else replaces. A view's options are edited this way, so a client that
 * sends only what it changed never removes options it doesn't know.
 */
export function mergePatch(target: unknown, patch: unknown): unknown {
  if (!isObject(patch)) return patch;
  const merged: Record<string, unknown> = isObject(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch))
    if (value === null) delete merged[key];
    else merged[key] = mergePatch(merged[key], value);
  return merged;
}

/**
 * The merge patch that turns `current` into `next` as a whole, removing what `next` lacks, for an
 * option whose shapes differ (one GroupBy for another), which merging would mix.
 */
export function replacing(current: unknown, next: unknown): unknown {
  if (!isObject(current) || !isObject(next)) return next;
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(current)) if (!(key in next)) patch[key] = null;
  for (const [key, value] of Object.entries(next)) patch[key] = replacing(current[key], value);
  return patch;
}

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
