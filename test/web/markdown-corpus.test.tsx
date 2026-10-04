// Every note rendered as the Read view renders it: no errors, and as many checkboxes as the
// server counts in `progress`, which is what click-to-tick relies on to map a box to its line.
// The committed corpus (corpus/*.md) holds what notes are made of; real notes stay out of the
// repository, so to run it on them too: `pad export > notes.json`, then
// `PAD_CORPUS=notes.json bun test test/web/markdown-corpus.test.tsx`.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";

import { progress } from "@/shared/checklist";
import type { Note } from "@/shared/domain";
import { NoteMarkdown } from "@/web/components/editor/note-markdown";
import { readNote } from "@/web/lib/note-markdown";

const dir = join(import.meta.dir, "corpus");

const corpus: { name: string; body: string; total: number }[] = [
  ...readdirSync(dir).map((f) => {
    const body = readFileSync(join(dir, f), "utf8");
    return { name: f, body, total: progress(body).total };
  }),
  ...(process.env.PAD_CORPUS
    ? (JSON.parse(readFileSync(process.env.PAD_CORPUS, "utf8")) as Note[]).map((n) => ({
        name: n.id,
        body: n.body,
        // The server's count, as the API returned it.
        total: n.progress.total,
      }))
    : []),
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
