// Every note rendered as the Read view renders it: no errors, and as many checkboxes as the
// server counts in `progress`, which is what click-to-tick relies on to map a box to its line.
// The committed corpus (corpus/*.md) holds what notes are made of; real notes stay out of the
// repository, so to run it on them too: `pad export notes.json`, then
// `PAD_CORPUS=notes.json bun test test/web/markdown-corpus.test.tsx`.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";

import { parseArchive } from "@/shared/archive";
import { progress } from "@/shared/checklist";
import { NoteMarkdown } from "@/web/components/editor/note-markdown";
import { readNote } from "@/web/lib/note-markdown";

const dir = join(import.meta.dir, "corpus");

/** The notes of a `pad export` file (either version), counted as the server counts them. */
function exported(path: string) {
  const parsed = parseArchive(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.archive.notes.map((n, i) => ({
    name: n.id ?? `note ${i + 1}`,
    body: n.body ?? "",
    total: progress(n.body ?? "").total,
  }));
}

const corpus: { name: string; body: string; total: number }[] = [
  ...readdirSync(dir).map((f) => {
    const body = readFileSync(join(dir, f), "utf8");
    return { name: f, body, total: progress(body).total };
  }),
  ...(process.env.PAD_CORPUS ? exported(process.env.PAD_CORPUS) : []),
];

describe("markdown corpus", () => {
  test("has notes to read", () => {
    expect(corpus.length).toBeGreaterThan(2);
  });

  test.each(corpus)("$name: renders, with a box for each task the server counts", (note) => {
    const html = renderToStaticMarkup(<NoteMarkdown body={note.body} onToggle={() => {}} />);
    expect(html.match(/role="checkbox"/g)?.length ?? 0).toBe(note.total);
    expect(readNote(note.body).editable).toBe(true);
  });
});
