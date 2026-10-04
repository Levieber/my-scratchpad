import { skipToken, useQuery } from "@tanstack/react-query";

import { api } from "@/web/lib/api";
import { keys, queryClient } from "@/web/lib/queries";

// History is read when asked for, never polled: it opens on what was just saved (the editor
// syncs first), and it is gone the moment the note is edited again.

export const useRevisions = (id: string) =>
  useQuery({ queryKey: keys.revisions(id), queryFn: () => api.revisions(id) });

/** What revision `to` changed; nothing to ask until one is chosen. */
export const useDiff = (id: string, to: number | null) =>
  useQuery({
    queryKey: keys.diff(id, to ?? -1),
    queryFn: to === null ? skipToken : () => api.diff(id, to),
  });

/** A revision whole, to restore it. */
export const loadRevision = (id: string, rev: number) =>
  queryClient.query({
    queryKey: keys.revision(id, rev),
    queryFn: () => api.revision(id, rev),
  });
