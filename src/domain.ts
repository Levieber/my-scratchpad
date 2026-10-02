// The shapes the API speaks, as Effect Schemas: the server decodes requests and rows with them, and
// every client (the PWA included, type-only) shares the types derived from them.
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";

import { KIND_NAMES } from "./kinds";

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
  /** Create only: a client-chosen id (see src/ids.ts), so a note made offline keeps it. */
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

/** A named search: `query` is what goes in the search box, operators included (src/query.ts). */
export const View = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  query: Schema.String,
  created_at: Schema.String,
});
export type View = typeof View.Type;

export type Tag = { tag: string; count: number };

/** `GET /api/notes/:id/diff`: `from` null means compared with an empty note. */
export type NoteDiff = {
  note_id: string;
  from: Revision | null;
  to: Revision;
  changes: Partial<Record<"title" | "tags" | "kind", { from: unknown; to: unknown }>>;
  diff: string;
};

// One line per field, worded for whoever reads the raw error: Schema's own messages name the
// innermost failure ("Expected string at ["tags"][0]"), which says less than the field's rule.
const FIELD_RULES: Record<string, string> = {
  id: "id must be 8-64 letters, digits, '-' or '_'",
  title: "title must be a string",
  body: "body must be a string",
  tags: "tags must be an array of strings",
};

/** The top-level field a decoding failure is about, or undefined when the value isn't an object. */
export function failedField(error: Schema.SchemaError): string | undefined {
  const find = (issue: SchemaIssue.Issue): string | undefined => {
    if (issue._tag === "Pointer") return String(issue.path[0]);
    if (issue._tag === "Composite") return find(issue.issues[0]);
    return undefined;
  };
  return find(error.issue);
}

/** A failure to decode a note input, as the sentence the API and `pad import` report. */
export const inputProblem = (error: Schema.SchemaError) => {
  const field = failedField(error);
  return (field && FIELD_RULES[field]) ?? "Expected a JSON object";
};
