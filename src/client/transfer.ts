// Export and import of notes as JSON, on top of the public API only (no new endpoints).
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { type Note, NoteInput } from "@/shared/domain";
import { failedField, inputProblem } from "@/shared/validation";

import { ApiError, Client, type ListParams } from "./client";

// The API's page cap (see Store.list).
const PAGE = 500;

/** Every note matching the filters, as `GET /api/notes` returns them, so the file is `pad ls --json`. */
export const exportNotes = Effect.fnUntraced(function* (
  filter: Omit<ListParams, "limit" | "offset"> = {},
) {
  const client = yield* Client;
  const notes: Note[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = yield* client.list({ ...filter, limit: PAGE, offset });
    notes.push(...page);
    if (page.length < PAGE) return notes;
  }
});

const invalid = (message: string) => new ApiError({ status: 400, message });
const decodeInput = Schema.decodeUnknownEffect(NoteInput);

/** Reads an export (a JSON array of notes) into API inputs; fails with an ApiError naming what is wrong. */
export const parseExport = Effect.fnUntraced(function* (text: string) {
  const data: unknown = yield* Effect.try({
    try: () => JSON.parse(text),
    catch: () => invalid("Not valid JSON. Import a file made by `pad export`."),
  });
  if (!Array.isArray(data)) return yield* invalid("Expected a JSON array of notes.");
  return yield* Effect.forEach(data, (item: unknown, i) => {
    const where = `Item ${i + 1}`;
    if (!item || typeof item !== "object" || Array.isArray(item))
      return Effect.fail(invalid(`${where} is not a note object.`));
    return Effect.mapError(decodeInput(item), (error) => {
      const field = failedField(error);
      if (field === "id") return invalid(`${where}: invalid id.`);
      if (field === "kind")
        return invalid(
          `${where}: unknown kind ${JSON.stringify((item as { kind?: unknown }).kind)}.`,
        );
      return invalid(`${where}: ${inputProblem(error)}.`);
    });
  });
});

export type ImportResult = {
  created: number;
  /** Notes whose id already exists on the server; left untouched. */
  skipped: number;
  failed: { item: number; message: string }[];
};

/**
 * Creates each note, keeping its id so importing the same file twice changes nothing. Author and
 * timestamps are not carried over: the API attributes a note to whoever creates it, now.
 */
export const importNotes = Effect.fnUntraced(function* (inputs: readonly NoteInput[]) {
  const client = yield* Client;
  const result: ImportResult = { created: 0, skipped: 0, failed: [] };
  for (const [i, input] of inputs.entries()) {
    yield* client.create(input).pipe(
      Effect.match({
        onSuccess: () => void result.created++,
        onFailure: (e) => {
          if (e.code === "noteExists") result.skipped++;
          else result.failed.push({ item: i + 1, message: e.message });
        },
      }),
    );
  }
  return result;
});
