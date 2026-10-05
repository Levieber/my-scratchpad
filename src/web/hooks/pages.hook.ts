import { skipToken, useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

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
