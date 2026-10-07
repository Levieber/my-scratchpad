import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

import { usePending } from "@/web/hooks/pending.hook";
import { api, type Note } from "@/web/lib/api";
import { withPending } from "@/web/lib/pending";
import { keys, POLL_MS, queryClient } from "@/web/lib/queries";

/**
 * The list for a search, as it will be once the outbox is sent (`withPending`, applied on every
 * read, so an answer from before an edit never shows over it). While a new search, or a longer
 * page of it, loads, the last one stays on screen (`loading`).
 */
export function useNotes(q: string, limit: number) {
  const pending = usePending();
  const select = useCallback(
    (list: Note[]) => ({
      notes: withPending(list, pending, !q),
      canLoadMore: list.length >= limit,
    }),
    [pending, q, limit],
  );
  const { data, isPlaceholderData } = useQuery({
    queryKey: keys.list(q, limit),
    queryFn: () => api.list({ q, limit }),
    placeholderData: keepPreviousData,
    refetchInterval: POLL_MS,
    select,
  });
  return { ...(data ?? { notes: [], canLoadMore: false }), loading: isPlaceholderData };
}

const EMPTY: never[] = [];

/** The pinned notes, as they will be once the outbox is sent. */
export function usePins() {
  const pending = usePending();
  const select = useCallback((pins: Note[]) => withPending(pins, pending, false), [pending]);
  return (
    useQuery({ queryKey: keys.pins, queryFn: api.pins, refetchInterval: POLL_MS, select }).data ??
    EMPTY
  );
}

export const useTags = () =>
  useQuery({ queryKey: keys.tags, queryFn: api.tags, refetchInterval: POLL_MS }).data ?? EMPTY;

export const useViews = () =>
  useQuery({ queryKey: keys.views, queryFn: api.views, refetchInterval: POLL_MS }).data ?? EMPTY;

/** A note any list read so far holds, for when the server can't be asked. */
export const listedNote = (id: string) =>
  queryClient
    .getQueriesData<Note[]>({ queryKey: [...keys.notes, "list"] })
    .flatMap(([, list]) => list ?? [])
    .find((n) => n.id === id);
