// The export archive: the file `pad export` and the PWA write and every deployment reads, so a
// user can leave one deployment for another, or restore a backup years later. Its shape is
// specified in docs/export-format.md; the version moves only when an older reader would misread it.
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { HookSelection, Kind, type Note, NoteId, type View } from "./domain";
import { KIND_NAMES } from "./kinds";
import { failedField, inputProblem } from "./validation";

export const ARCHIVE_FORMAT = "pad-export";
/** The newest version this code reads and writes. Version 1 was a bare array of notes. */
export const ARCHIVE_VERSION = 2;

/** What a server accepts in one import unless its operator says otherwise: generous, not unbounded. */
export const DEFAULT_MAX_IMPORT_BYTES = 64 * 1024 * 1024;

const Timestamp = Schema.String.pipe(
  Schema.check(Schema.makeFilter((s) => !Number.isNaN(Date.parse(s)) || "not a date")),
);
const NonEmpty = Schema.String.pipe(
  Schema.check(Schema.makeFilter((s) => s.trim() !== "" || "must not be empty")),
);
const Tags = Schema.mutable(Schema.Array(Schema.String));

/**
 * A revision as it was written: content as of `updated_at`. Its place in the list is its place in
 * the history (oldest first), so the database's own ids, which mean nothing elsewhere, stay out.
 */
export const ArchiveRevision = Schema.Struct({
  title: Schema.String,
  body: Schema.String,
  tags: Tags,
  kind: Kind,
  author: Schema.String,
  updated_at: Timestamp,
  /** Left out, they are counted again from the bodies. */
  added: Schema.optionalKey(Schema.Number),
  removed: Schema.optionalKey(Schema.Number),
});
export type ArchiveRevision = typeof ArchiveRevision.Type;

/**
 * A note as an importer reads it. Only content is needed: whatever an archive leaves out is filled
 * in by the importer (a new id, the author sending it, the time of the import), so a hand-written
 * file and a version 1 export both import. `progress` is derived, never read.
 */
export const ArchiveNote = Schema.Struct({
  id: Schema.optionalKey(NoteId),
  title: Schema.optionalKey(Schema.String),
  body: Schema.optionalKey(Schema.String),
  tags: Schema.optionalKey(Tags),
  kind: Schema.optionalKey(Kind),
  author: Schema.optionalKey(Schema.String),
  created_at: Schema.optionalKey(Timestamp),
  updated_at: Schema.optionalKey(Timestamp),
  /** Oldest first. Without them the note's history starts at its current content. */
  revisions: Schema.optionalKey(Schema.Array(ArchiveRevision)),
});
export type ArchiveNote = typeof ArchiveNote.Type;

export const ArchiveView = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  name: NonEmpty,
  query: NonEmpty,
  created_at: Schema.optionalKey(Timestamp),
});
export type ArchiveView = typeof ArchiveView.Type;

/** Pins in the order they were pinned. */
export const ArchivePin = Schema.Struct({
  note_id: Schema.String,
  pinned_at: Schema.optionalKey(Timestamp),
});
export type ArchivePin = typeof ArchivePin.Type;

/** A note as `GET /api/export` writes it: all of the note but its derived `progress`. */
export type ExportedNote = Omit<Note, "progress"> & { revisions?: ArchiveRevision[] };

/** `GET /api/export`: what the importers above read back. */
export type ExportArchive = {
  format: typeof ARCHIVE_FORMAT;
  version: typeof ARCHIVE_VERSION;
  exported_at: string;
  /** Where it came from; for people, never read back. */
  source: { app_version: string };
  notes: ExportedNote[];
  views: View[];
  pins: { note_id: string; pinned_at: string }[];
  hook_selections: HookSelection[];
};

/** `GET /api/import`: what a client may send, and that this server imports at all. */
export type ImportLimits = {
  /** The archive versions it reads. */
  formats: number[];
  max_bytes: number;
};

/** How a part of an import went: what was written, and what was left as it was. */
export type ImportTally = { created: number; skipped: number };

/** `POST /api/import`'s answer. `failed` names each item that could not be imported and why. */
export type ImportResult = ImportTally & {
  views: ImportTally;
  pins: ImportTally;
  hook_selections: ImportTally;
  failed: { item: string; message: string }[];
};

/** What `parseArchive` reads: every part is a list, empty when the file has none of it. */
export type Archive = {
  version: number;
  notes: ArchiveNote[];
  views: ArchiveView[];
  pins: ArchivePin[];
  hook_selections: HookSelection[];
  /** Items that could not be read, each by its position ("note 3"): a bad one costs only itself. */
  rejected: { item: string; message: string }[];
};

export type ArchiveRefusal = { code: "invalidImport" | "unsupportedFormat"; message: string };

export type ParsedArchive = { ok: true; archive: Archive } | ({ ok: false } & ArchiveRefusal);

const refuse = (code: ArchiveRefusal["code"], message: string): ParsedArchive => ({
  ok: false,
  code,
  message,
});

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** One kind of item: how it decodes, what its rejection says, and the rule beyond its shape. */
type Part<A> = {
  label: string;
  decode: (item: unknown) => Result.Result<A, Schema.SchemaError>;
  explain: (item: unknown, error: Schema.SchemaError) => string;
  check?: (read: A) => string | undefined;
};

const parts = {
  note: {
    label: "note",
    decode: Schema.decodeUnknownResult(ArchiveNote),
    explain: (item, error) => {
      if (!isObject(item)) return "not a note object";
      return failedField(error) === "kind"
        ? `kind must be one of: ${KIND_NAMES.join(", ")}`
        : inputProblem(error);
    },
    check: (note) =>
      note.body?.trim() || note.title?.trim() ? undefined : "needs a body or a title",
  } satisfies Part<ArchiveNote>,
  view: {
    label: "view",
    decode: Schema.decodeUnknownResult(ArchiveView),
    explain: () => "name and query must be non-empty strings",
  } satisfies Part<ArchiveView>,
  pin: {
    label: "pin",
    decode: Schema.decodeUnknownResult(ArchivePin),
    explain: () => "note_id must be a string",
  } satisfies Part<ArchivePin>,
  selection: {
    label: "hook selection",
    decode: Schema.decodeUnknownResult(HookSelection),
    explain: () => "not a hook selection",
  } satisfies Part<HookSelection>,
};

/** Reads `list` item by item: the ones that decode, and the rest into `rejected`. */
function readItems<A>(part: Part<A>, list: unknown, rejected: Archive["rejected"]): A[] {
  if (list === undefined) return [];
  if (!Array.isArray(list)) {
    rejected.push({ item: part.label, message: `${part.label}s must be a list` });
    return [];
  }
  const read: A[] = [];
  list.forEach((item: unknown, i) => {
    const decoded = part.decode(item);
    const message = Result.isFailure(decoded)
      ? part.explain(item, decoded.failure)
      : part.check?.(decoded.success);
    if (Result.isSuccess(decoded) && message === undefined) read.push(decoded.success);
    else rejected.push({ item: `${part.label} ${i + 1}`, message: message ?? "" });
  });
  return read;
}

/**
 * Reads an archive of any version this code knows: a version 1 bare array, or a version 2 object.
 * A whole file is refused only when no part of it can be trusted (not an archive, or from a newer
 * version, which may mean things this code would misread); otherwise a bad item is rejected alone.
 * Unknown fields, in the archive or in an item, are left out, so a newer deployment's extra data
 * doesn't stop an older one from importing the rest.
 */
export function parseArchive(data: unknown): ParsedArchive {
  const rejected: Archive["rejected"] = [];
  if (Array.isArray(data)) {
    const notes = readItems(parts.note, data, rejected);
    return {
      ok: true,
      archive: { version: 1, notes, views: [], pins: [], hook_selections: [], rejected },
    };
  }
  if (!isObject(data))
    return refuse("invalidImport", "Expected a file made by `pad export`: an archive or an array.");
  if (data.format !== ARCHIVE_FORMAT)
    return refuse(
      "invalidImport",
      `Not a ${ARCHIVE_FORMAT} archive: its format is missing or wrong.`,
    );
  const { version } = data;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1)
    return refuse("invalidImport", "The archive's version must be a whole number.");
  if (version > ARCHIVE_VERSION)
    return refuse(
      "unsupportedFormat",
      `This archive is version ${version}; this server reads up to version ${ARCHIVE_VERSION}. Update the server, or export again from one that writes a version it reads.`,
    );
  if (!Array.isArray(data.notes))
    return refuse("invalidImport", "The archive's notes must be a list.");
  return {
    ok: true,
    archive: {
      version,
      notes: readItems(parts.note, data.notes, rejected),
      views: readItems(parts.view, data.views, rejected),
      pins: readItems(parts.pin, data.pins, rejected),
      hook_selections: readItems(parts.selection, data.hook_selections, rejected),
      rejected,
    },
  };
}
