// What the app does around export and import that isn't drawing: what to ask for, what to check
// before sending a file, and how to word the server's answer.
import type { ImportResult, ImportTally } from "@/shared/archive";

const MIB = 1024 * 1024;

/** The address of an export: everything, or what a search lists; without history on request. */
export function exportPath(q: string, history: boolean) {
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  if (!history) params.set("history", "false");
  const query = params.toString();
  return query ? `/api/export?${query}` : "/api/export";
}

/** Named for the day it was made, so a folder of backups sorts. */
export const exportFilename = (exportedAt: string) => `pad-export-${exportedAt.slice(0, 10)}.json`;

const megabytes = (bytes: number) => (bytes / MIB).toFixed(1).replace(/\.0$/, "");

/** Why a file of `size` bytes shouldn't be sent: more than the server takes. Null when it may. */
export function tooLarge(size: number, max: number | undefined) {
  if (max === undefined || size <= max) return null;
  return `This file is ${megabytes(size)} MB; the server takes at most ${megabytes(max)} MB.`;
}

/** The file's JSON, or what to tell the person. The server judges the rest: it knows its versions. */
export function readImportFile(text: string): { data: unknown } | { error: string } {
  try {
    return { data: JSON.parse(text) };
  } catch {
    return { error: "This is not a JSON file. Choose one made by Export." };
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// "2 pins imported, 1 already here": the part of an import that had something to say.
function line(tally: ImportTally, one: string, many: string, kept = "") {
  const { created, skipped } = tally;
  if (!created && !skipped) return [];
  const here = `already here${kept}`;
  if (!created) return [`${plural(skipped, one, many)} ${here}.`];
  const imported = `${plural(created, one, many)} imported`;
  return [skipped ? `${imported}, ${skipped} ${here}.` : `${imported}.`];
}

/** The server's answer in sentences, a line per part that had something to say. */
export function importSummary(result: ImportResult) {
  const lines = [
    ...line(
      result,
      "note",
      "notes",
      result.skipped === 1 ? " and left as it is" : " and left as they are",
    ),
    ...line(result.views, "saved search", "saved searches"),
    ...line(result.pins, "pin", "pins"),
    ...line(result.hook_selections, "hook choice", "hook choices"),
  ];
  return lines.length ? lines : ["Nothing to import."];
}
