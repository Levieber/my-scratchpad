// How a board makes its columns from notes, and what moving a note to one does to its tags. Pure,
// so tested without React; the columns are tags (or the checklist), never fields of their own, so
// notes, the API and an export stay as they are.
import { type GroupBy, isObject } from "@/shared/layouts";
import type { Note } from "@/web/lib/api";

/** What a board shows when its view chose nothing: the usual to do / doing / done by tag. */
export const DEFAULT_GROUP_BY = {
  by: "prefix",
  prefix: "status:",
  columns: ["todo", "doing", "done"],
} as const satisfies GroupBy;

export type Column = {
  key: string;
  label: string;
  notes: Note[];
  /** The tag a note moved here gets; null for the "none" column, which takes them away. */
  tag: string | null;
};

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((s) => typeof s === "string") : null);

/** A view's `options.groupBy`, if this app can read it; otherwise the default. */
export function readGroupBy(value: unknown): GroupBy {
  if (!isObject(value)) return DEFAULT_GROUP_BY;
  const columns = strings(value.columns);
  const tags = strings(value.tags);
  if (value.by === "prefix" && typeof value.prefix === "string" && value.prefix)
    return { by: "prefix", prefix: value.prefix, ...(columns && { columns }) };
  if (value.by === "tags" && tags) return { by: "tags", tags };
  if (value.by === "checklist") return { by: "checklist" };
  return DEFAULT_GROUP_BY;
}

/** Whether moving a note between columns means anything: the checklist is the body's to say. */
export const movable = (g: GroupBy) => g.by !== "checklist";

const NONE = "";

const CHECKLIST = [
  { key: "none", label: "No tasks", has: (n: Note) => n.progress.total === 0 },
  { key: "todo", label: "To do", has: (n: Note) => n.progress.total > 0 && n.progress.done === 0 },
  {
    key: "doing",
    label: "Under way",
    has: (n: Note) => n.progress.done > 0 && n.progress.done < n.progress.total,
  },
  {
    key: "done",
    label: "Done",
    has: (n: Note) => n.progress.total > 0 && n.progress.done === n.progress.total,
  },
];

/**
 * The board's columns, in order, each with its notes in the order given. With a prefix, the
 * declared columns come first (shown even when empty, so there is somewhere to move a note to),
 * then any other value in use, alphabetically. A note goes in the first column it qualifies for,
 * so one with two statuses shows once. The "none" column comes last.
 */
export function columnsOf(notes: readonly Note[], g: GroupBy): Column[] {
  if (g.by === "checklist")
    return CHECKLIST.map(({ key, label, has }) => ({
      key,
      label,
      notes: notes.filter(has),
      tag: null,
    }));

  const values =
    g.by === "prefix"
      ? unique([
          ...(g.columns ?? []),
          ...notes
            .flatMap((n) => n.tags.filter((t) => t.startsWith(g.prefix)))
            .map((t) => t.slice(g.prefix.length))
            .filter(Boolean)
            .toSorted(),
        ])
      : unique(g.tags);
  const tagOf = (value: string) => (g.by === "prefix" ? g.prefix + value : value);
  const columns: Column[] = values.map((value) => ({
    key: value,
    label: value,
    notes: [],
    tag: tagOf(value),
  }));
  const none: Column = { key: NONE, label: noneLabel(g), notes: [], tag: null };
  for (const n of notes) (columns.find((c) => n.tags.includes(c.tag!)) ?? none).notes.push(n);
  return [...columns, none];
}

const unique = (values: readonly string[]) => [...new Set(values)];

const noneLabel = (g: GroupBy) =>
  g.by === "prefix" ? `No ${g.prefix.replace(/[:/=-]+$/, "")}` : "None of these";

/**
 * A note's tags once moved to `column`: the tags that placed it in a column go, and the column's
 * own comes in. Every other tag stays where it was.
 */
export function movedTags(tags: readonly string[], g: GroupBy, column: Column): string[] {
  const kept = tags.filter((t) => !isGrouping(g, t));
  return column.tag ? [...kept, column.tag] : kept;
}

/** Whether `tag` is one that puts a note in a column (which a card needn't repeat). */
export const isGrouping = (g: GroupBy, tag: string) =>
  g.by === "prefix" ? tag.startsWith(g.prefix) : g.by === "tags" && g.tags.includes(tag);

/** The column `note` is in. */
export const columnOf = (columns: readonly Column[], id: string) =>
  columns.find((c) => c.notes.some((n) => n.id === id));
