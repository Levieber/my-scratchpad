import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";

import { bodyRef } from "@/web/hooks/focus";
import { usePending } from "@/web/hooks/pending.hook";
import { api, type Note, type Tag, type View } from "@/web/lib/api";
import { handle } from "@/web/lib/failures";
import { onSynced, session } from "@/web/lib/session";
import { outbox, syncer } from "@/web/lib/storage";
import { type Outcome, withPending, withSettled } from "@/web/lib/sync";

const PAGE = 50;

type Data = {
  q: string;
  limit: number;
  notes: Note[];
  tags: Tag[];
  views: View[];
  pins: Note[];
  setQ: (q: string) => void;
  setLimit: Dispatch<SetStateAction<number>>;
  setPins: Dispatch<SetStateAction<Note[]>>;
  refresh: () => Promise<Note[] | undefined>;
};

const DataContext = createContext<Data | null>(null);

/** What the server has (the list, tags, views, pins), refreshed live, and the search it's for. */
export function DataProvider({ children }: { children: ReactNode }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [views, setViews] = useState<View[]>([]);
  const [pins, setPins] = useState<Note[]>([]);
  // Everything that narrows the list (kind, author, tags, words) is one query string, so a view
  // is just that string saved under a name.
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);

  // Answers arrive out of order on a slow network. Each refresh is numbered, and one that a newer
  // refresh or a landed save overtook is dropped: it would put back what was there before.
  const latest = useRef(0);
  const refresh = useCallback(async () => {
    const asked = ++latest.current;
    try {
      const [n, t, v, p] = await Promise.all([
        api.list({ q, limit }),
        api.tags(),
        api.views(),
        api.pins(),
      ]);
      if (asked !== latest.current) return;
      setNotes(n);
      setTags(t);
      setViews(v);
      setPins(p);
      return n;
    } catch (e) {
      handle(e);
    }
  }, [q, limit]);
  // For the subscriptions below: the refresh and search in force when they fire.
  const refreshNow = useEffectEvent(refresh);
  const settle = useEffectEvent((outcome: Outcome) => {
    latest.current++;
    setNotes((n) => withSettled(n, outcome, !q));
    setPins((p) => withSettled(p, outcome, false));
  });

  // Search / tag filter.
  useEffect(() => {
    const t = setTimeout(refresh, 200);
    return () => clearTimeout(t);
  }, [refresh]);

  // A save or delete the server accepted shows at once; a sync run ends with a refresh.
  useEffect(() => {
    const settled = syncer.onSettled(settle);
    const synced = onSynced((r) => {
      if (r.status === "done" || r.status === "error") void refreshNow();
    });
    return () => {
      settled();
      synced();
    };
  }, []);

  // Poll so notes written by agents or the CLI show up live; reload the open note if it changed
  // remotely. Each tick also retries whatever the outbox still holds.
  useEffect(() => {
    const tick = async () => {
      if (document.hidden) return;
      if (outbox.all().length) await session.sync();
      const list = await refreshNow();
      const open = session.getSnapshot().current;
      const fresh = open && list?.find((n) => n.id === open.id);
      // Not while the person is in the body: the text would change under the cursor.
      if (fresh && document.activeElement !== bodyRef.current) session.receive(fresh);
    };
    const id = setInterval(tick, 5000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  const value = useMemo(
    () => ({ q, limit, notes, tags, views, pins, setQ, setLimit, setPins, refresh }),
    [q, limit, notes, tags, views, pins, refresh],
  );
  return <DataContext value={value}>{children}</DataContext>;
}

export function useData() {
  const data = useContext(DataContext);
  if (!data) throw new Error("useData outside DataProvider");
  return data;
}

/** The search in force, and changing it. */
export function useSearch() {
  const { q, setQ, setLimit } = useData();
  return {
    q,
    filter: (next: string) => {
      setQ(next);
      setLimit(PAGE);
    },
    loadMore: () => setLimit((l) => l + PAGE),
  };
}

/** The list as the server last sent it, without the outbox applied. */
export const useListed = () => useData().notes;

/** The list for the search in force, as it will be once the outbox is sent. */
export function useNotes() {
  const { notes, q, limit } = useData();
  const pending = usePending();
  const shown = useMemo(() => withPending(notes, pending, !q), [notes, pending, q]);
  return { notes: shown, canLoadMore: notes.length >= limit };
}

export function usePins() {
  const { pins } = useData();
  const pending = usePending();
  return useMemo(() => withPending(pins, pending, false), [pins, pending]);
}

export const useTags = () => useData().tags;
export const useViews = () => useData().views;
