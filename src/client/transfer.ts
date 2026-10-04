// Export and import of notes as a JSON archive (docs/export-format.md), on top of the public API.
// A server from before archives has neither endpoint: then notes alone are moved, one by one.
import * as Effect from "effect/Effect";

import { type ExportArchive, type ImportResult, parseArchive } from "@/shared/archive";
import type { Note } from "@/shared/domain";

import { ApiError, Client, type ListParams } from "./client";

// The API's page cap (see Store.list).
const PAGE = 500;

type Filter = Omit<ListParams, "limit" | "offset">;

/** A server that has never heard of the endpoint answers 404 to it. */
const isMissing = (e: ApiError) => e.status === 404;

export type Exported = {
  /** The archive, or (from an older server) the bare array of notes version 1 files are. */
  data: ExportArchive | Note[];
  notes: number;
  /** Whether each note carries its revisions. */
  history: boolean;
  /** True when the server had no archive and only the notes were read. */
  fallback: boolean;
};

/** Every note matching the filters, a page at a time, as `GET /api/notes` returns them. */
const listAll = Effect.fnUntraced(function* (filter: Filter) {
  const client = yield* Client;
  const notes: Note[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = yield* client.list({ ...filter, limit: PAGE, offset });
    notes.push(...page);
    if (page.length < PAGE) return notes;
  }
});

/** The server's archive of the notes matching `filter`; the notes alone from a server without one. */
export const exportNotes = Effect.fnUntraced(function* (
  filter: Filter = {},
  { history = true }: { history?: boolean } = {},
) {
  const client = yield* Client;
  return yield* client.exportArchive(filter, history).pipe(
    Effect.map((data): Exported => ({ data, notes: data.notes.length, history, fallback: false })),
    Effect.catchIf(isMissing, () =>
      Effect.map(listAll(filter), (data): Exported => ({
        data,
        notes: data.length,
        history: false,
        fallback: true,
      })),
    ),
  );
});

export type Imported = {
  result: ImportResult;
  /** True when the server had no import and the notes were created one by one. */
  fallback: boolean;
};

const invalid = (message: string, code = "invalidImport") =>
  new ApiError({ status: 400, message, code });

/**
 * What a server without `POST /api/import` can still do: create each note with its id, so
 * importing twice changes nothing. History, authors, dates, views and pins can't be written
 * through the notes API, so they are left behind.
 */
const importNotesOneByOne = Effect.fnUntraced(function* (data: unknown) {
  const parsed = parseArchive(data);
  if (!parsed.ok) return yield* invalid(parsed.message, parsed.code);
  const client = yield* Client;
  const result: ImportResult = {
    created: 0,
    skipped: 0,
    views: { created: 0, skipped: 0 },
    pins: { created: 0, skipped: 0 },
    hook_selections: { created: 0, skipped: 0 },
    failed: [...parsed.archive.rejected],
  };
  for (const [i, note] of parsed.archive.notes.entries()) {
    const { id, title, body, tags, kind } = note;
    yield* client.create({ id, title, body, tags, kind }).pipe(
      Effect.match({
        onSuccess: () => void result.created++,
        onFailure: (e) => {
          if (e.code === "noteExists") result.skipped++;
          else result.failed.push({ item: `note ${note.id ?? i + 1}`, message: e.message });
        },
      }),
    );
  }
  return result;
});

/**
 * Sends a file made by `pad export` (an archive, or the bare array older versions wrote) to the
 * server, which reads it: this client doesn't judge a version, since the server may know newer
 * ones than this build.
 */
export const importFile = Effect.fnUntraced(function* (text: string) {
  const data: unknown = yield* Effect.try({
    try: () => JSON.parse(text),
    catch: () => invalid("Not valid JSON. Import a file made by `pad export`.", "invalidJson"),
  });
  const client = yield* Client;
  return yield* client.importArchive(data).pipe(
    Effect.map((result): Imported => ({ result, fallback: false })),
    Effect.catchIf(isMissing, () =>
      Effect.map(importNotesOneByOne(data), (result): Imported => ({ result, fallback: true })),
    ),
  );
});
