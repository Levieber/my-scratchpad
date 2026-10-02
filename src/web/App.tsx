import { useCallback, useEffect, useRef, useState } from "react";

import { newId } from "@/shared/ids";
import { Editor } from "@/web/components/Editor";
import { Sidebar } from "@/web/components/Sidebar";
import { Splitter } from "@/web/components/Splitter";
import { TokenDialog } from "@/web/components/TokenDialog";
import {
  api,
  type FullRevision,
  isApiError,
  Offline,
  onConnectivity,
  token,
  Unauthorized,
  type Note,
  type Tag,
  type View,
} from "@/web/lib/api";
import {
  type Draft,
  emptyDraft,
  fromDraft,
  type SaveState,
  saveLabel,
  toDraft,
} from "@/web/lib/draft";
import { pinState } from "@/web/lib/pins";
import { outbox, storedWidth, storeWidth, syncer } from "@/web/lib/storage";
import { localNote, mergeFields, baseOf, fieldsOf, withPending } from "@/web/lib/sync";
import { cn } from "@/web/lib/utils";

const PAGE = 50;

export function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [views, setViews] = useState<View[]>([]);
  const [pins, setPins] = useState<Note[]>([]);
  // Everything that narrows the list (kind, author, tags, words) is one query string, so a view
  // is just that string saved under a name.
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [width, setWidth] = useState(storedWidth);
  const [listHidden, setListHidden] = useState(false);
  const [online, setOnline] = useState(true);
  const [needsToken, setNeedsToken] = useState(false);

  // Editor: `current` is the saved note (null = unsaved new note), `draft` the form state.
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<Note | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saveState, setSaveState] = useState<SaveState>("");
  const [saveError, setSaveError] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  // Edits and deletes the server doesn't have yet (src/web/sync.ts).
  const [pending, setPending] = useState(outbox.all);

  // Refs so timers/intervals see the latest values without re-subscribing.
  const latest = useRef({ current, draft, dirty: false });
  latest.current.current = current;
  latest.current.draft = draft;

  const handle = useCallback((e: unknown) => {
    if (e instanceof Unauthorized) setNeedsToken(true);
    else if (!(e instanceof Offline)) console.error(e);
  }, []);

  useEffect(() => onConnectivity(setOnline), []);
  useEffect(() => outbox.subscribe(() => setPending(outbox.all())), []);

  const refreshList = useCallback(async () => {
    try {
      const [n, t, v, p] = await Promise.all([
        api.list({ q, limit }),
        api.tags(),
        api.views(),
        api.pins(),
      ]);
      setNotes(n);
      setTags(t);
      setViews(v);
      setPins(p);
      return n;
    } catch (e) {
      handle(e);
    }
  }, [q, limit, handle]);

  // Sends the outbox. What the server answers for the open note arrives through onSettled below.
  const sync = useCallback(async () => {
    const open = latest.current.current;
    if (open && outbox.get(open.id)) setSaveState("saving");
    const result = await syncer.run();
    if (result.status === "unauthorized") setNeedsToken(true);
    const cur = latest.current.current;
    if (cur && outbox.get(cur.id) && !latest.current.dirty) {
      if (result.status === "offline") setSaveState("local");
      if (result.status === "error") {
        setSaveError(result.message);
        setSaveState("error");
      }
    }
    if (result.status === "done") void refreshList();
  }, [refreshList]);

  useEffect(() => {
    syncer.onSettled = ({ sent, note, merged, conflict }) => {
      const l = latest.current;
      if (!note || sent.op !== "save" || l.current?.id !== note.id) return;
      const waiting = outbox.get(note.id);
      // A newer edit still waiting was typed on top of this one; it carries the merge onward.
      if (!waiting && merged) {
        // Typing since the save started from what was sent, so it merges into the result too.
        const next = l.dirty
          ? mergeFields(sent.fields, fromDraft(l.draft), note).fields
          : fieldsOf(note);
        l.draft = toDraft(next);
        setDraft(l.draft);
      }
      l.current = note;
      setCurrent(note);
      if (!waiting)
        setSaveState(conflict ? "conflict" : merged ? "merged" : l.dirty ? "pending" : "saved");
    };
  }, []);

  // Queues what the editor shows. Synchronous, so a tab being closed still keeps the edit.
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const commit = useCallback(() => {
    const l = latest.current;
    clearTimeout(timer.current);
    if (!l.dirty) return;
    l.dirty = false;
    const { current, draft } = l;
    if (!current && !draft.body.trim() && !draft.title.trim()) return;
    const fields = fromDraft(draft);
    if (current) {
      outbox.save(current.id, fields, baseOf(current));
    } else {
      // A new note gets its id here, so it can be edited, listed and deleted before it syncs.
      const note = localNote(newId(), fields);
      l.current = note;
      setCurrent(note);
      outbox.save(note.id, fields, null);
    }
  }, []);

  const save = useCallback(async () => {
    commit();
    await sync();
  }, [commit, sync]);

  // Debounced autosave.
  const edit = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    latest.current.dirty = true;
    setSaveState("pending");
    clearTimeout(timer.current);
    timer.current = setTimeout(save, 600);
  };
  // Leaving a note never waits for the network: the edit is safe in the outbox either way.
  const flush = () => {
    if (!latest.current.dirty) return;
    commit();
    void sync();
  };

  const showDraft = (note: Note | null, d: Draft) => {
    latest.current.current = note;
    latest.current.draft = d;
    setCurrent(note);
    setDraft(d);
    setShowHistory(false);
    setOpen(true);
  };

  const show = async (load: () => Promise<Note>) => {
    flush();
    try {
      const n = await load();
      const waiting = outbox.get(n.id);
      showDraft(n, toDraft(waiting?.op === "save" ? waiting.fields : n));
      setSaveState(waiting ? "local" : "");
    } catch (e) {
      handle(e);
    }
  };
  const openNote = (id: string) =>
    show(async () => {
      try {
        return await api.get(id);
      } catch (e) {
        // Offline, or made here and not synced yet: the list has the whole note, or the outbox does.
        const p = outbox.get(id);
        const known =
          notes.find((n) => n.id === id) ??
          (p?.op === "save" ? localNote(id, p.fields) : undefined);
        if (known && !(e instanceof Unauthorized)) return known;
        throw e;
      }
    });

  const newNote = async (body = "") => {
    flush();
    showDraft(null, { ...emptyDraft, body });
    setSaveState("");
  };

  // From the editor (the open note, or a new one never saved) or from the list (any note).
  const remove = (note = latest.current.current) => {
    if (note && !confirm(`Delete "${note.title}"?`)) return;
    if (!note || note.id === latest.current.current?.id) {
      clearTimeout(timer.current);
      latest.current.dirty = false;
      setCurrent(null);
      setOpen(false);
    }
    if (note) {
      outbox.delete(note.id);
      void sync();
    }
  };

  const toggleHistory = async () => {
    if (showHistory) return setShowHistory(false);
    // So the latest revision is what's on screen.
    commit();
    await sync();
    setShowHistory(true);
  };

  const restore = (r: FullRevision) => {
    setShowHistory(false);
    edit({ title: r.title, body: r.body, tags: r.tags.join(", "), kind: r.kind });
  };

  // Search / tag filter.
  useEffect(() => {
    const t = setTimeout(refreshList, 200);
    return () => clearTimeout(t);
  }, [refreshList]);

  // Poll so notes written by agents or the CLI show up live; reload the open note if it changed
  // remotely. Each tick also retries whatever the outbox still holds.
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const tick = async () => {
      if (document.hidden) return;
      if (outbox.all().length) await sync();
      const list = await refreshList();
      const { current, dirty } = latest.current;
      if (
        !list ||
        !current ||
        dirty ||
        outbox.get(current.id) ||
        document.activeElement === bodyRef.current
      )
        return;
      const fresh = list.find((n) => n.id === current.id);
      if (fresh && fresh.updated_at !== current.updated_at) {
        setCurrent(fresh);
        setDraft(toDraft(fresh));
      }
    };
    const id = setInterval(tick, 5000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refreshList, sync]);

  // Send what was left from last time, and send again the moment the connection returns.
  const syncRef = useRef(sync);
  syncRef.current = sync;
  useEffect(() => {
    const retry = () => void syncRef.current();
    retry();
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, []);

  // Keyboard shortcuts + share-target (/?text=...).
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl+K types nothing, so unlike "/" it works from inside a field too, the note being
      // written included. Taken from the browser, whose own Ctrl+K searches the web.
      if (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey) && !e.altKey) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (e.key.toLowerCase() === "n" && e.ctrlKey && e.altKey) {
        e.preventDefault();
        void newNote().then(() => bodyRef.current?.focus());
      } else if (e.key === "s" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void save();
      }
    };
    // Only the outbox write: a request started now may never finish, and the next visit sends it.
    const onUnload = () => commit();
    document.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onUnload);

    const p = new URLSearchParams(location.search);
    const shared = [p.get("title"), p.get("text"), p.get("url")].filter(Boolean).join("\n");
    if (shared) {
      history.replaceState(null, "", "/");
      void newNote(shared).then(() => {
        latest.current.dirty = true;
        return save();
      });
    }
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onUnload);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => storeWidth(width), [width]);

  const filter = (next: string) => {
    setQ(next);
    setLimit(PAGE);
  };

  const activeSave = saveLabel(saveState, saveError);

  const saveView = async (name: string) => {
    try {
      await api.createView(name, q.trim());
      void refreshList();
      return "saved" as const;
    } catch (e) {
      // A name already taken is the only failure the person can fix.
      if (isApiError(e, "viewExists")) return "taken" as const;
      handle(e);
      return "failed" as const;
    }
  };
  const removeView = async (v: View) => {
    try {
      await api.deleteView(v.id);
      await refreshList();
    } catch (e) {
      handle(e);
    }
  };

  const shown = withPending(notes, pending, !q);
  const pinned = withPending(pins, pending, false);
  // History and pins live on the server, so a note it hasn't seen yet has neither.
  const unsyncedIds = new Set(pending.flatMap((p) => (p.op === "save" && !p.base ? [p.id] : [])));
  const unsynced = current ? unsyncedIds.has(current.id) : false;
  const pinnedIds = new Set(pinned.map((n) => n.id));
  const pinOf = (id: string | undefined) => pinState(id, pinnedIds, unsyncedIds);

  // Shown at once, then corrected by what the server says; a refusal puts the list back.
  const togglePin = async (note: Note) => {
    const unpin = pinnedIds.has(note.id);
    setPins((p) => (unpin ? p.filter((n) => n.id !== note.id) : [...p, note]));
    try {
      await (unpin ? api.unpin(note.id) : api.pin(note.id));
    } catch (e) {
      handle(e);
    }
    await refreshList();
  };

  return (
    // No note open: the list is the whole page. A note open: list | resize handle | editor on a
    // wide screen, the editor alone on a phone.
    <div
      className={cn(
        "grid h-dvh grid-cols-[minmax(0,1fr)] pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]",
        open && !listHidden && "wide:grid-cols-[var(--sidebar)_auto_minmax(0,1fr)]",
      )}
      style={{ "--sidebar": `${width}px` } as React.CSSProperties}
    >
      <Sidebar
        layout={open ? (listHidden ? "hidden" : "column") : "page"}
        q={q}
        onFilter={filter}
        searchRef={searchRef}
        onNew={() => newNote().then(() => bodyRef.current?.focus())}
        views={views}
        onSaveView={saveView}
        onRemoveView={(v) => void removeView(v)}
        tags={tags}
        notes={shown}
        pinned={pinned}
        pinOf={pinOf}
        onTogglePin={(n) => void togglePin(n)}
        onDelete={remove}
        currentId={current?.id}
        canLoadMore={notes.length >= limit}
        onLoadMore={() => setLimit((l) => l + PAGE)}
        onOpen={(id) => void openNote(id)}
        online={online}
        pendingChanges={pending.length}
      />

      {open && !listHidden && <Splitter width={width} onChange={setWidth} />}

      {open && (
        <Editor
          draft={draft}
          onEdit={edit}
          current={current}
          showHistory={showHistory}
          historyDisabled={!current || unsynced}
          historyHint={
            unsynced ? "History starts once the note has synced" : "What changed, and when"
          }
          pin={pinOf(current?.id)}
          onTogglePin={() => current && void togglePin(current)}
          listHidden={listHidden}
          onToggleList={() => setListHidden(!listHidden)}
          onBack={() => {
            flush();
            setOpen(false);
          }}
          onToggleHistory={() => void toggleHistory()}
          onDelete={() => remove()}
          onRestore={restore}
          bodyRef={bodyRef}
          saveLabel={activeSave}
        />
      )}

      {needsToken && (
        <TokenDialog
          onSave={(t) => {
            token.set(t);
            setNeedsToken(false);
            void refreshList();
            void sync();
          }}
        />
      )}
    </div>
  );
}
