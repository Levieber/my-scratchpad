import { skipToken, useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

import { NOTE_ID } from "@/shared/domain";
import { sameTitle } from "@/shared/links";
import { openNote } from "@/web/hooks/editor.hook";
import { newNote } from "@/web/hooks/focus";
import { listedNote } from "@/web/hooks/notes.hook";
import { usePending } from "@/web/hooks/pending.hook";
import { api, ApiError, type Note, Unauthorized } from "@/web/lib/api";
import { pendingUnder } from "@/web/lib/pending";
import { keys, POLL_MS, queryClient } from "@/web/lib/queries";

const EMPTY: never[] = [];

// A page holds few notes; more than this and a page has become a list, which a search serves.
export const MOST = 200;

/** The notes under `parent` (`none`: at the top), by title, including those not synced yet. */
export function useSubpages(parent: string | null, enabled = true) {
  const pending = usePending();
  const select = useCallback(
    (list: Note[]) =>
      pendingUnder(list, pending, parent ?? "none").toSorted((a, b) =>
        a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true }),
      ),
    [pending, parent],
  );
  const { data } = useQuery({
    queryKey: keys.children(parent ?? "none"),
    queryFn: enabled ? () => api.list({ parent: parent ?? "none", limit: MOST }) : skipToken,
    refetchInterval: POLL_MS,
    select,
  });
  return data ?? EMPTY;
}

// A loop is refused by the server; this only stops a walk through data that predates that.
const DEEPEST = 32;

/** The note `id` as this device can best know it: the cache, the server, or a list read before. */
async function noteFor(id: string) {
  try {
    return await queryClient.query({
      queryKey: keys.note(id),
      queryFn: () => api.get(id),
      staleTime: POLL_MS,
    });
  } catch (e) {
    const known = listedNote(id);
    if (known && !(e instanceof Unauthorized)) return known;
    throw e;
  }
}

/** The pages above `note`, from the top down: what its breadcrumbs show. */
export function usePath(note: Note | null) {
  const parent = note?.parent_id;
  const { data } = useQuery({
    queryKey: keys.path(note?.id ?? "", parent ?? ""),
    queryFn: parent
      ? async () => {
          const path: Note[] = [];
          for (let id: string | null = parent; id && path.length < DEEPEST;) {
            const page: Note = await noteFor(id);
            path.unshift(page);
            id = page.parent_id;
          }
          return path;
        }
      : skipToken,
    refetchInterval: POLL_MS,
  });
  return parent ? (data ?? EMPTY) : EMPTY;
}

// A title is looked up in the search's pages, latest first: a note may be older than a screenful
// of notes that mention its title. Past this many, a link is to a title nobody has.
const TITLE_PAGE = 100;
const TITLE_PAGES = 10;

/** The note with this id, if `target` is one: a guess, so a refusal is only "no". */
async function noteWithId(target: string): Promise<string | null> {
  if (!NOTE_ID.test(target)) return null;
  try {
    // Not through the query cache, whose failures are shown: most titles that look like an id
    // (one long word) are only titles.
    return (await api.get(target)).id;
  } catch (e) {
    if (e instanceof Unauthorized) throw e;
    if (e instanceof ApiError) return null;
    // Offline: a note this device has read.
    return queryClient.getQueryData<Note>(keys.note(target))?.id ?? listedNote(target)?.id ?? null;
  }
}

/** The latest note titled `target`, which the search lists first. */
async function noteTitled(target: string): Promise<string | null> {
  const titled = (notes: Note[]) => notes.find((n) => sameTitle(n.title, target))?.id ?? null;
  try {
    for (let page = 0; page < TITLE_PAGES; page++) {
      const notes = await api.list({ q: target, limit: TITLE_PAGE, offset: page * TITLE_PAGE });
      const id = titled(notes);
      if (id || notes.length < TITLE_PAGE) return id;
    }
    return null;
  } catch (e) {
    if (e instanceof Unauthorized) throw e;
    // Offline: what the lists read before hold.
    return titled(
      queryClient
        .getQueriesData<Note[]>({ queryKey: [...keys.notes, "list"] })
        .flatMap(([, list]) => list ?? []),
    );
  }
}

/** The note `[[target]]` names: the one with that id, else the latest with that title. */
const resolveLink = async (target: string) =>
  (await noteWithId(target)) ?? (await noteTitled(target));

/** Follows a link to a note; one to a title nobody has yet starts that note. */
export async function openLink(target: string) {
  const id = await resolveLink(target);
  if (id) return openNote(id);
  newNote(`# ${target}\n\n`);
}

/** The notes linking to `note` (`[[its title]]`, `[[its id]]`), latest first. */
export function useBacklinks(note: Note) {
  const { data } = useQuery({
    queryKey: keys.backlinks(note.id),
    queryFn: () => api.backlinks(note.id),
    refetchInterval: POLL_MS,
  });
  return data ?? EMPTY;
}
