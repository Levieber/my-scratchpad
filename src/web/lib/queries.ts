// What the app reads from the server, cached by TanStack Query: one client, its keys, and how
// it retries. Reads only: every write to a note goes through the outbox (lib/outbox.ts), which
// settles into this cache.
import { QueryCache, QueryClient } from "@tanstack/react-query";

import { type Note, Offline, Unauthorized } from "@/web/lib/api";
import { handle } from "@/web/lib/failures";
import { withSettled, withSettledUnder } from "@/web/lib/pending";
import type { Outcome } from "@/web/lib/sync";

// Every key starts with the server, so a cache never answers for another one.
const server = location.origin;

export const keys = {
  /** Everything read from this server. */
  all: [server] as const,
  notes: [server, "notes"] as const,
  list: (q: string, limit: number) => [server, "notes", "list", q, limit] as const,
  note: (id: string) => [server, "notes", "one", id] as const,
  /** The notes under a page (`none`: at the top). */
  children: (parent: string) => [server, "notes", "children", parent] as const,
  /** The notes linking to a note. */
  backlinks: (id: string) => [server, "notes", "backlinks", id] as const,
  /** The pages above a note under `parent`, from the top down. */
  path: (id: string, parent: string) => [server, "notes", "path", id, parent] as const,
  revisions: (id: string) => [server, "revisions", id] as const,
  diff: (id: string, to: number) => [server, "revisions", id, "diff", to] as const,
  revision: (id: string, rev: number) => [server, "revisions", id, rev] as const,
  tags: [server, "tags"] as const,
  views: [server, "views"] as const,
  pins: [server, "pins"] as const,
  hooks: [server, "hooks"] as const,
  /** What an import may send; absent from a server that can't import. */
  importLimits: [server, "import"] as const,
  /** What a hook shows where `scope` applies. */
  hookNotes: (hook: string, scope: string) => [server, "hooks", hook, scope] as const,
};

/** How often what others write (agents, the CLI) shows up while the page is visible. */
export const POLL_MS = 5000;

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handle }),
  defaultOptions: {
    queries: {
      // Asking again can't help without a connection or a token; the poll tries later anyway.
      retry: (failures, e) => !(e instanceof Unauthorized || e instanceof Offline) && failures < 2,
      // Offline, the service worker still answers from its cache (public/sw.js); navigator.onLine
      // is no reason to stop asking.
      networkMode: "always",
    },
    // A failure goes back to the person through the mutation's own onError (rolled back, or
    // worded by the form); not every refusal is an error to log.
    mutations: { networkMode: "always" },
  },
});

/**
 * A save or delete the server accepted, in the cache at once: the outbox forgets the entry the
 * moment it lands, so without this the list would show the note as it was until the next poll.
 * A read already under way started before the write and would bring the old note back: it is
 * dropped (cancelled, keeping what is cached), and the sync run's end asks again.
 */
export function settle(outcome: Outcome) {
  void queryClient.cancelQueries({ queryKey: keys.notes }, { revert: false });
  void queryClient.cancelQueries({ queryKey: keys.pins }, { revert: false });
  for (const [key, list] of queryClient.getQueriesData<Note[]>({
    queryKey: [...keys.notes, "list"],
  }))
    if (list) queryClient.setQueryData(key, withSettled(list, outcome, !key[3]));
  for (const [key, list] of queryClient.getQueriesData<Note[]>({
    queryKey: [...keys.notes, "children"],
  }))
    if (list) queryClient.setQueryData(key, withSettledUnder(list, String(key[3]), outcome));
  queryClient.setQueryData<Note[]>(keys.pins, (pins) => pins && withSettled(pins, outcome, false));
  const { sent, note } = outcome;
  if (note) queryClient.setQueryData(keys.note(note.id), note);
  else if (sent.op === "delete") queryClient.removeQueries({ queryKey: keys.note(sent.id) });
}

/** After a sync run: what the server now has, asked again. */
export const refetchNotes = () =>
  Promise.all(
    [keys.notes, keys.tags, keys.views, keys.pins].map((queryKey) =>
      queryClient.invalidateQueries({ queryKey }),
    ),
  );
