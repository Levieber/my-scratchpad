// Moving everything out of the database and into another: the export archive's two ends
// (shared/archive.ts). Notes are written here, history included; views, pins and hook selections
// go through their own areas.
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";

import type {
  Archive,
  ArchiveNote,
  ArchiveRevision,
  ExportedNote,
  ImportResult,
  ImportTally,
} from "@/shared/archive";
import { diffStats } from "@/shared/diff/lines";
import { isHookName, normalizeScope } from "@/shared/hooks";
import { newId } from "@/shared/ids";
import { MAX_PINS } from "@/shared/pins";
import { deriveTitle } from "@/shared/title";

import { HookLimit, NoteNotFound, PinLimit } from "./errors";
import type { makeHooks } from "./hooks";
import { type ListQuery, makeNotes, normTags } from "./notes";
import type { makePins } from "./pins";
import { decodeRevision } from "./rows";
import { nowIso, run } from "./sql";
import type { makeViews } from "./views";

// Notes are read a page at a time, as `list` caps a page.
const PAGE = 500;

export type ExportQuery = Omit<ListQuery, "limit" | "offset">;

type Parts = {
  list: ReturnType<typeof makeNotes>["list"];
  checkParent: ReturnType<typeof makeNotes>["checkParent"];
  views: ReturnType<typeof makeViews>["views"];
  hookSelections: ReturnType<typeof makeHooks>["hookSelections"];
  pinRows: ReturnType<typeof makePins>["pinRows"];
  importView: ReturnType<typeof makeViews>["importView"];
  importPin: ReturnType<typeof makePins>["importPin"];
  importHookSelection: ReturnType<typeof makeHooks>["importHookSelection"];
};

const isFiltered = (q: ExportQuery) =>
  Boolean(q.q?.trim() || q.kind || q.author || q.tags?.length || q.parent);

const tally = (): ImportTally => ({ created: 0, skipped: 0 });

export const makeTransfer = (sql: SqlClient.SqlClient, parts: Parts) => {
  const revisionsOf = (ids: readonly string[]) =>
    Effect.gen(function* () {
      const byNote = new Map<string, ArchiveRevision[]>();
      if (!ids.length) return byNote;
      const rows =
        yield* sql`SELECT * FROM note_revisions WHERE note_id IN ${sql.in(ids)} ORDER BY id`;
      for (const row of yield* Effect.forEach(rows, decodeRevision)) {
        const { id: _, note_id, ...revision } = row;
        byNote.set(note_id, [...(byNote.get(note_id) ?? []), revision]);
      }
      return byNote;
    });

  /**
   * The notes `query` matches, all of them, with their history unless `history` is off, in one
   * read so the pages agree. Views and hook selections are the user's own setup and go only in a
   * whole export; pins go with the notes they pin.
   */
  const exportData = (query: ExportQuery, { history }: { history: boolean }) =>
    run(
      Effect.gen(function* () {
        const notes: ExportedNote[] = [];
        for (let offset = 0; ; offset += PAGE) {
          const page = yield* parts.list({ ...query, limit: PAGE, offset });
          const revisions = history ? yield* revisionsOf(page.map((n) => n.id)) : undefined;
          for (const { progress: _, subpages: __, ...note } of page)
            notes.push(revisions ? { ...note, revisions: revisions.get(note.id) ?? [] } : note);
          if (page.length < PAGE) break;
        }
        const whole = !isFiltered(query);
        const ids = new Set(notes.map((n) => n.id));
        return {
          notes,
          views: whole ? yield* parts.views : [],
          pins: (yield* parts.pinRows).filter((p) => whole || ids.has(p.note_id)),
          hook_selections: whole ? yield* parts.hookSelections : [],
        };
      }).pipe(sql.withTransaction),
    );

  /**
   * Writes one note as the archive had it: its dates, its author and its revisions as they are,
   * without the folding that live edits get. What it leaves out is filled in; a note that exists
   * is left alone.
   */
  const importNote = (note: ArchiveNote, importer: string) =>
    Effect.gen(function* () {
      const id = note.id ?? newId();
      if ((yield* sql`SELECT 1 FROM notes WHERE id = ${id}`).length) return { id, created: false };
      const now = yield* nowIso;
      const body = note.body ?? "";
      const row = {
        id,
        title: note.title?.trim() || deriveTitle(body),
        body,
        tags: normTags(note.tags),
        kind: note.kind ?? "note",
        author: note.author ?? importer,
        created_at: note.created_at ?? note.updated_at ?? now,
        updated_at: note.updated_at ?? note.created_at ?? now,
      };
      yield* sql`INSERT INTO notes ${sql.insert({ ...row, tags: JSON.stringify(row.tags) })}`;
      const history: readonly ArchiveRevision[] = note.revisions?.length
        ? note.revisions
        : [
            {
              title: row.title,
              body: row.body,
              tags: row.tags,
              kind: row.kind,
              author: row.author,
              updated_at: row.updated_at,
            },
          ];
      let previous = "";
      for (const revision of history) {
        const stats = diffStats(previous, revision.body);
        yield* sql`INSERT INTO note_revisions ${sql.insert({
          note_id: id,
          title: revision.title,
          body: revision.body,
          tags: JSON.stringify(normTags(revision.tags)),
          kind: revision.kind,
          author: revision.author,
          updated_at: revision.updated_at,
          added: revision.added ?? stats.added,
          removed: revision.removed ?? stats.removed,
        })}`;
        previous = revision.body;
      }
      return { id, created: true };
    }).pipe(sql.withTransaction);

  /**
   * Imports what `parseArchive` read, as `importer`. Each note is its own transaction, so one
   * that fails costs only itself; pins and hook selections apply only to notes this import
   * created, since a note that already existed is left exactly as it was.
   */
  const importArchive = (archive: Archive, importer: string) =>
    run(
      Effect.gen(function* () {
        const result: ImportResult = {
          ...tally(),
          views: tally(),
          pins: tally(),
          hook_selections: tally(),
          failed: [...archive.rejected],
        };
        const imported = new Set<string>();
        const count = (part: ImportTally, outcome: "created" | "skipped") => void part[outcome]++;

        for (const note of archive.notes) {
          const { id, created } = yield* importNote(note, importer);
          if (created) imported.add(id);
          count(result, created ? "created" : "skipped");
        }
        // Parents once every note is in, since an archive may list a page after what is under it.
        // Only for the notes created now; one that already existed keeps its place.
        for (const note of archive.notes) {
          const id = note.id;
          if (!id || !note.parent_id || !imported.has(id)) continue;
          yield* parts.checkParent(id, note.parent_id).pipe(
            Effect.andThen(sql`UPDATE notes SET parent_id = ${note.parent_id} WHERE id = ${id}`),
            Effect.catchTag("InvalidParent", (e) =>
              Effect.sync(
                () => void result.failed.push({ item: `parent of ${id}`, message: e.reason }),
              ),
            ),
          );
        }
        for (const view of archive.views) count(result.views, yield* parts.importView(view));

        for (const pin of archive.pins) {
          const item = `pin ${pin.note_id}`;
          if (!imported.has(pin.note_id)) {
            const known = yield* sql`SELECT 1 FROM notes WHERE id = ${pin.note_id}`;
            if (known.length) count(result.pins, "skipped");
            else result.failed.push({ item, message: "No note with this id" });
            continue;
          }
          yield* parts.importPin(pin.note_id, pin.pinned_at).pipe(
            Effect.match({
              onSuccess: (outcome) => count(result.pins, outcome),
              onFailure: (e: NoteNotFound | PinLimit) =>
                void result.failed.push({
                  item,
                  message:
                    e._tag === "PinLimit"
                      ? `At most ${MAX_PINS} notes can be pinned`
                      : "No note with this id",
                }),
            }),
          );
        }

        for (const selection of archive.hook_selections) {
          const item = `hook selection ${selection.hook}${selection.scope ? ` ${selection.scope}` : ""}`;
          const { hook } = selection;
          const scope = normalizeScope(selection.scope);
          if (!isHookName(hook) || scope === undefined) {
            result.failed.push({
              item,
              message: isHookName(hook) ? "Not a valid scope" : `No such hook: ${hook}`,
            });
            continue;
          }
          yield* parts.importHookSelection({ ...selection, hook, scope }).pipe(
            Effect.match({
              onSuccess: (outcome) => count(result.hook_selections, outcome),
              onFailure: (e: HookLimit) => void result.failed.push({ item, message: e.reason }),
            }),
          );
        }
        return result;
      }),
    );

  return { exportData, importArchive };
};
