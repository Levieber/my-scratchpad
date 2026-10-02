// Export and import of notes as JSON, on top of the public API only (no new endpoints).
import { ApiError, type Client, type ListParams } from "./client";
import type { Note, NoteInput } from "./db";
import { isNoteId } from "./ids";
import { isKind } from "./kinds";

// The API's page cap (see Store.list).
const PAGE = 500;

/** Every note matching the filters, as `GET /api/notes` returns them, so the file is `pad ls --json`. */
export async function exportNotes(
  client: Pick<Client, "list">,
  filter: Omit<ListParams, "limit" | "offset"> = {},
): Promise<Note[]> {
  const notes: Note[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await client.list({ ...filter, limit: PAGE, offset });
    notes.push(...page);
    if (page.length < PAGE) return notes;
  }
}

/** Reads an export (a JSON array of notes) into API inputs; throws an ApiError naming what is wrong. */
export function parseExport(text: string): NoteInput[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ApiError(400, "Not valid JSON. Import a file made by `pad export`.");
  }
  if (!Array.isArray(data)) throw new ApiError(400, "Expected a JSON array of notes.");
  return data.map((item: unknown, i) => {
    const where = `Item ${i + 1}`;
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new ApiError(400, `${where} is not a note object.`);
    const { id, title, body, tags, kind } = item as Record<string, unknown>;
    if (id !== undefined && !isNoteId(id)) throw new ApiError(400, `${where}: invalid id.`);
    if (title !== undefined && typeof title !== "string")
      throw new ApiError(400, `${where}: title must be a string.`);
    if (body !== undefined && typeof body !== "string")
      throw new ApiError(400, `${where}: body must be a string.`);
    if (tags !== undefined && (!Array.isArray(tags) || !tags.every((t) => typeof t === "string")))
      throw new ApiError(400, `${where}: tags must be an array of strings.`);
    if (kind !== undefined && !isKind(kind))
      throw new ApiError(400, `${where}: unknown kind ${JSON.stringify(kind)}.`);
    return { id, title, body, tags, kind };
  });
}

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
export async function importNotes(
  client: Pick<Client, "create">,
  inputs: NoteInput[],
): Promise<ImportResult> {
  const result: ImportResult = { created: 0, skipped: 0, failed: [] };
  for (const [i, input] of inputs.entries()) {
    try {
      await client.create(input);
      result.created++;
    } catch (e) {
      if (e instanceof ApiError && e.code === "noteExists") result.skipped++;
      else result.failed.push({ item: i + 1, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return result;
}
