import { skipToken, useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

import { sameTitle } from "@/shared/links";
import { openNote } from "@/web/hooks/editor.hook";
import { newNote } from "@/web/hooks/focus";
import { listedNote } from "@/web/hooks/notes.hook";
import { usePending } from "@/web/hooks/pending.hook";
import { api, type Note, Unauthorized } from "@/web/lib/api";
import { pendingUnder } from "@/web/lib/pending";
import { keys, POLL_MS, queryClient } from "@/web/lib/queries";

const EMPTY: never[] = [];

// A page holds few notes; more than this and a page has become a list, which a search serves.
const MOST = 200;

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

/** The note `[[target]]` names: the one with that id, else the latest with that title. */
async function resolveLink(target: string): Promise<string | null> {
  if (/^[A-Za-z0-9_-]{8,64}$/.test(target))
    try {
      return (await noteFor(target)).id;
    } catch {}
  const titled = (notes: Note[]) => notes.find((n) => sameTitle(n.title, target))?.id ?? null;
  try {
    // The list is latest first, so the first with the title is the one a title names.
    return titled(await api.list({ q: target, limit: 50 }));
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
