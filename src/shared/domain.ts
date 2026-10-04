// The shapes the API speaks, as Effect Schemas: the server decodes requests and rows with them, and
// every client (the PWA included, type-only) shares the types derived from them.
import * as Schema from "effect/Schema";

import { KIND_NAMES } from "./kinds";
import { type Layout, TABLE_COLUMNS } from "./layouts";

export const Kind = Schema.Literals(KIND_NAMES);

/** What the API accepts as a client-chosen id: URL-safe and long enough not to collide by accident. */
export const NoteId = Schema.String.pipe(Schema.check(Schema.isPattern(/^[A-Za-z0-9_-]{8,64}$/)));

export const Progress = Schema.Struct({ done: Schema.Number, total: Schema.Number });
export type Progress = typeof Progress.Type;

const Tags = Schema.mutable(Schema.Array(Schema.String));

export const Note = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  body: Schema.String,
  tags: Tags,
  kind: Kind,
  author: Schema.String,
  created_at: Schema.String,
  updated_at: Schema.String,
  /** Derived from the body's checkboxes on every read, never stored. */
  progress: Progress,
});
export type Note = typeof Note.Type;

export const NoteInput = Schema.Struct({
  /** Create only: a client-chosen id (see shared/ids.ts), so a note made offline keeps it. */
  id: Schema.optionalKey(NoteId),
  title: Schema.optionalKey(Schema.String),
  body: Schema.optionalKey(Schema.String),
  tags: Schema.optionalKey(Tags),
  kind: Schema.optionalKey(Kind),
});
export type NoteInput = typeof NoteInput.Type;

/**
 * A note's content as of `updated_at`. Saves by one author close together are one revision, so an
 * autosaving editor records an editing session rather than every pause in typing.
 */
export const Revision = Schema.Struct({
  id: Schema.Number,
  note_id: Schema.String,
  title: Schema.String,
  tags: Tags,
  kind: Kind,
  /** Who made the change (X-Pad-Author), unlike the note's author, who created it. */
  author: Schema.String,
  updated_at: Schema.String,
  /** Lines added and removed since the previous revision. */
  added: Schema.Number,
  removed: Schema.Number,
});
export type Revision = typeof Revision.Type;

export const FullRevision = Schema.Struct({ ...Revision.fields, body: Schema.String });
export type FullRevision = typeof FullRevision.Type;

export const withoutBody = (full: FullRevision): Revision => {
  const { body: _, ...revision } = full;
  return revision;
};

/**
 * The options each layout (shared/layouts.ts) understands, all optional. They share one object on
 * a view, so a view keeps a layout's options while it shows another; an option's name therefore
 * means the same thing in every layout that declares it.
 */
export const LAYOUT_OPTIONS = {
  list: {},
  grid: {},
  table: {
    sort: Schema.optionalKey(
      Schema.Struct({
        by: Schema.Literals(TABLE_COLUMNS),
        desc: Schema.optionalKey(Schema.Boolean),
      }),
    ),
  },
  board: {
    groupBy: Schema.optionalKey(
      Schema.Union([
        Schema.Struct({
          by: Schema.Literal("prefix"),
          prefix: Schema.NonEmptyString,
          columns: Schema.optionalKey(Schema.Array(Schema.String)),
        }),
        Schema.Struct({ by: Schema.Literal("tags"), tags: Schema.Array(Schema.String) }),
        Schema.Struct({ by: Schema.Literal("checklist") }),
      ]),
    ),
  },
} satisfies Record<Layout, Schema.Struct.Fields>;

/**
 * A view's options as far as this version knows them. Only checks: options it doesn't know (a
 * newer layout's, or a newer option) are kept as they came, never stripped.
 */
export const KnownViewOptions = Schema.Struct({
  ...LAYOUT_OPTIONS.list,
  ...LAYOUT_OPTIONS.grid,
  ...LAYOUT_OPTIONS.table,
  ...LAYOUT_OPTIONS.board,
});
export type KnownViewOptions = typeof KnownViewOptions.Type;

const ViewOptions = Schema.Record(Schema.String, Schema.Unknown);

/**
 * A named search and how to show it: `query` is what goes in the search box, operators included
 * (shared/query.ts). `layout` is null when the view leaves it to the device's preference, and a
 * string rather than a known layout because a newer app may have chosen one this version lacks.
 */
export const View = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  query: Schema.String,
  layout: Schema.NullOr(Schema.String),
  options: ViewOptions,
  created_at: Schema.String,
});
export type View = typeof View.Type;

/** `PATCH /api/views/:id`: omitted fields are unchanged; `options` is a JSON Merge Patch. */
export type ViewPatch = {
  name?: string;
  query?: string;
  layout?: Layout | null;
  options?: Record<string, unknown>;
};

/** `POST /api/views`: a name and a query, and optionally how to show it. */
export type NewView = ViewPatch & { name: string; query: string };

export type Tag = { tag: string; count: number };

/** `GET /api/notes/:id/diff`: `from` null means compared with an empty note. */
export type NoteDiff = {
  note_id: string;
  from: Revision | null;
  to: Revision;
  changes: Partial<Record<"title" | "tags" | "kind", { from: unknown; to: unknown }>>;
  diff: string;
};

/**
 * The notes a hook shows where `scope` applies (shared/hooks.ts): `include` (hand-picked ids)
 * first, then the search `query` (null: hand-picked only), up to `limit` notes in all.
 */
export const HookSelection = Schema.Struct({
  hook: Schema.String,
  scope: Schema.String,
  query: Schema.NullOr(Schema.String),
  include: Schema.mutable(Schema.Array(Schema.String)),
  limit: Schema.Number,
  updated_at: Schema.String,
  updated_by: Schema.String,
});
export type HookSelection = typeof HookSelection.Type;

/** `GET /api/hooks`: each hook with its default and the selections the user stored. */
export type HooksInfo = {
  max_include: number;
  hooks: {
    name: string;
    description: string;
    default: { query: string; limit: number };
    max_limit: number;
    selections: HookSelection[];
  }[];
};

/**
 * One block of what a hook shows: a selection that applies where the agent is, with its notes
 * already resolved. `source` says whose choice it is: the hook's default, the user's (stored), or
 * this machine's override of the search for everywhere.
 */
export type HookSection = {
  scope: string;
  query: string | null;
  source: "default" | "user" | "machine";
  limit: number;
  include: string[];
  notes: Note[];
};

/** `GET /api/hooks/:name/notes`: the sections, most specific first, no note shown twice. */
export type HookNotes = { hook: string; sections: HookSection[] };
