import { useCallback, useEffect, useRef, useState } from "react";

import { newId } from "@/ids";
import type { Kind } from "@/kinds";
import { hasToken, operatorValue, parseQuery, setOperator, toggleToken } from "@/query";

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
} from "./api";
import { History } from "./History";
import { ago, groupNotes, preview, visibleTags } from "./listing";
import {
  baseOf,
  type Fields,
  fieldsOf,
  localNote,
  mergeFields,
  Outbox,
  Syncer,
  withPending,
} from "./sync";

const PAGE = 50;
const TAG_LIMIT = 8;
const WIDTH_KEY = "pad-sidebar-width";
const MIN_WIDTH = 260;
const MAX_WIDTH = 560;
const clampWidth = (w: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(w)));

// The width is a per-device convenience, so storage failing (private mode) just means the default.
const storedWidth = () => {
  try {
    const w = Number(localStorage.getItem(WIDTH_KEY));
    return w ? clampWidth(w) : 360;
  } catch {
    return 360;
  }
};

// Private mode can refuse storage; the outbox then lasts as long as the tab.
const browserStorage = () => {
  try {
    return localStorage;
  } catch {
    return null;
  }
};

const outbox = new Outbox(browserStorage());
const syncer = new Syncer(outbox, api);

type Draft = { title: string; body: string; tags: string; kind: Kind };

const emptyDraft: Draft = { title: "", body: "", tags: "", kind: "note" };
const toDraft = (n: Fields): Draft => ({
  title: n.title,
  body: n.body,
  tags: n.tags.join(", "),
  kind: n.kind,
});
const fromDraft = (d: Draft): Fields => ({
  title: d.title,
  body: d.body,
  tags: d.tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean),
  kind: d.kind,
});

type SaveState = "" | "pending" | "saving" | "saved" | "local" | "merged" | "conflict" | "error";

export function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [views, setViews] = useState<View[]>([]);
  const [naming, setNaming] = useState<string | null>(null);
  const [nameTaken, setNameTaken] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  // Focus moves to the field once, when the person opens the form: not on every re-render, which
  // the 5 s poll would otherwise turn into stealing focus from the Save button.
  const formOpen = naming !== null;
  useEffect(() => {
    if (formOpen) nameRef.current?.focus();
  }, [formOpen]);
  // Everything that narrows the list (kind, author, tags, words) is one query string, so a view
  // is just that string saved under a name.
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [allTags, setAllTags] = useState(false);
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
      const [n, t, v] = await Promise.all([api.list({ q, limit }), api.tags(), api.views()]);
      setNotes(n);
      setTags(t);
      setViews(v);
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

  const remove = () => {
    if (current && !confirm(`Delete "${current.title}"?`)) return;
    clearTimeout(timer.current);
    latest.current.dirty = false;
    if (current) {
      outbox.delete(current.id);
      void sync();
    }
    setCurrent(null);
    setOpen(false);
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
      const typing = ["INPUT", "TEXTAREA"].includes(
        (document.activeElement as HTMLElement)?.tagName,
      );
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
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

  useEffect(() => {
    try {
      localStorage.setItem(WIDTH_KEY, String(width));
    } catch {}
  }, [width]);

  const filter = (next: string) => {
    setQ(next);
    setLimit(PAGE);
  };

  // Chips edit the search box, so several tags combine and the query stays visible.
  const selectedTags = parseQuery(q).tags;
  const kind = operatorValue(q, "kind");
  const author = operatorValue(q, "author");
  const sameQuery = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const activeView = views.find((v) => sameQuery(v.query, q));

  const saveView = async (name: string) => {
    try {
      await api.createView(name, q.trim());
      setNaming(null);
      await refreshList();
    } catch (e) {
      // A name already taken is the only failure the person can fix, so the form stays open and
      // says so (announced, and linked to the field).
      if (isApiError(e, "viewExists")) setNameTaken(true);
      else handle(e);
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
  const shownTags = allTags ? tags : visibleTags(tags, selectedTags, TAG_LIMIT);

  const saveLabel = {
    "": "",
    pending: "…",
    saving: "saving…",
    saved: "saved",
    local: "saved on this device · syncs when online",
    merged: "merged with changes made elsewhere",
    conflict: "edited elsewhere too: both versions kept between <<<<<<< and >>>>>>>",
    error: `not saved: ${saveError}`,
  }[saveState];

  const shown = withPending(notes, pending, !q);
  // History lives on the server, so a note it hasn't seen yet has none.
  const unsynced = pending.some((p) => p.id === current?.id && p.op === "save" && !p.base);

  return (
    <div
      className="app"
      data-view={open ? "editor" : "list"}
      data-list={open && listHidden ? "hidden" : undefined}
      style={{ "--sidebar": `${width}px` } as React.CSSProperties}
    >
      <aside className="sidebar">
        <header className="bar">
          <h1>Scratchpad</h1>
          <button
            className="primary"
            title="New note (Ctrl+Alt+N)"
            onClick={() => newNote().then(() => bodyRef.current?.focus())}
          >
            + New
          </button>
        </header>
        <input
          ref={searchRef}
          type="search"
          placeholder="Search…  (/)"
          value={q}
          onChange={(e) => filter(e.target.value)}
        />
        <div className="filters">
          <fieldset className="kinds" aria-label="Kind">
            {(
              [
                ["", "All"],
                ["note", "Notes"],
                ["reference", "Reference"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                aria-pressed={kind === k}
                onClick={() => filter(setOperator(q, "kind", k))}
              >
                {label}
              </button>
            ))}
          </fieldset>
          <fieldset className="kinds" aria-label="Author">
            {(
              [
                ["", "Anyone"],
                ["human", "Me"],
                ["agent", "Agents"],
              ] as const
            ).map(([a, label]) => (
              <button
                key={a}
                aria-pressed={author === a}
                onClick={() => filter(setOperator(q, "author", a))}
              >
                {label}
              </button>
            ))}
          </fieldset>
        </div>
        {(views.length > 0 || q.trim()) && (
          <fieldset className="tags views" aria-label="Saved views">
            {views.map((v) => (
              <span key={v.id} className="view" data-active={activeView?.id === v.id}>
                <button
                  className="apply"
                  aria-pressed={activeView?.id === v.id}
                  title={v.query}
                  onClick={() => filter(activeView?.id === v.id ? "" : v.query)}
                >
                  {v.name}
                </button>
                <button
                  className="remove"
                  aria-label={`Delete view ${v.name}`}
                  onClick={() => void removeView(v)}
                >
                  ×
                </button>
              </span>
            ))}
            {q.trim() && !activeView && naming === null && (
              <button
                className="more"
                onClick={() => {
                  setNameTaken(false);
                  setNaming("");
                }}
              >
                Save this search
              </button>
            )}
            {naming !== null && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (naming.trim()) void saveView(naming.trim());
                }}
              >
                <input
                  ref={nameRef}
                  aria-label="View name"
                  aria-invalid={nameTaken}
                  aria-describedby={nameTaken ? "view-name-error" : undefined}
                  placeholder="Name this view"
                  value={naming}
                  onChange={(e) => {
                    setNameTaken(false);
                    setNaming(e.target.value);
                  }}
                  onKeyDown={(e) => e.key === "Escape" && setNaming(null)}
                />
                <button className="more">Save</button>
                {nameTaken && (
                  <span id="view-name-error" role="alert" className="error">
                    A view with this name already exists
                  </span>
                )}
              </form>
            )}
          </fieldset>
        )}
        {tags.length > 0 && (
          <div className="tags">
            {shownTags.map((t) => (
              <button
                key={t.tag}
                aria-pressed={hasToken(q, `#${t.tag}`)}
                onClick={() => filter(toggleToken(q, `#${t.tag}`))}
              >
                #{t.tag} {t.count}
              </button>
            ))}
            {tags.length > TAG_LIMIT && (
              <button className="more" aria-expanded={allTags} onClick={() => setAllTags(!allTags)}>
                {allTags ? "Fewer tags" : `+${tags.length - shownTags.length} more`}
              </button>
            )}
          </div>
        )}
        <nav className="list" aria-label="Notes">
          {groupNotes(shown).map((g) => (
            <section key={g.label} aria-label={g.label}>
              <h2 className="group">{g.label}</h2>
              <ul>
                {g.notes.map((n) => {
                  const p = preview(n);
                  return (
                    <li key={n.id}>
                      {/* A real button, so the list works from the keyboard and screen readers. */}
                      <button
                        className="item"
                        aria-current={current?.id === n.id}
                        onClick={() => void openNote(n.id)}
                      >
                        <span className="t">{n.title}</span>
                        {p && <span className="p">{p}</span>}
                        <span className="m">
                          {n.kind === "note" && n.progress.total > 0 && (
                            <span className="done">
                              <progress
                                value={n.progress.done}
                                max={n.progress.total}
                                aria-hidden="true"
                              />
                              {n.progress.done}/{n.progress.total} ·{" "}
                            </span>
                          )}
                          {ago(n.updated_at)}
                          {n.kind === "reference" && kind !== "reference" && (
                            <span className="badge kind">reference</span>
                          )}
                          {n.author !== "human" && <span className="badge">{n.author}</span>}
                          {n.tags.length > 0 && <span> · #{n.tags.join(" #")}</span>}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {shown.length === 0 && <p className="m">{q ? "No matches." : "No notes yet."}</p>}
          {notes.length >= limit && (
            <button className="more" onClick={() => setLimit((l) => l + PAGE)}>
              Load more
            </button>
          )}
        </nav>
        <footer className="foot">
          <output className={online ? "status" : "status off"}>
            {online ? "online" : "offline"}
            {pending.length > 0 &&
              ` · ${pending.length} ${pending.length === 1 ? "change" : "changes"} to sync`}
          </output>
          <a href="/openapi.json" target="_blank">
            API
          </a>
        </footer>
      </aside>

      {open && !listHidden && <Splitter width={width} onChange={setWidth} />}

      {open && (
        <main className="editor">
          <header className="bar">
            <button
              className="ghost back"
              aria-label="Back to list"
              onClick={() => {
                flush();
                setOpen(false);
              }}
            >
              ←
            </button>
            <button
              className="ghost toggleList"
              aria-label={listHidden ? "Show note list" : "Hide note list"}
              aria-expanded={!listHidden}
              onClick={() => setListHidden(!listHidden)}
            >
              {listHidden ? "»" : "«"}
            </button>
            <input
              className="title"
              placeholder="Title"
              value={draft.title}
              onChange={(e) => edit({ title: e.target.value })}
            />
            <button
              className="ghost kindToggle"
              aria-pressed={draft.kind === "reference"}
              title="Reference: reusable rules to check work against (practices, checklists)"
              onClick={() => edit({ kind: draft.kind === "reference" ? "note" : "reference" })}
            >
              Reference
            </button>
            <button
              className="ghost kindToggle"
              aria-pressed={showHistory}
              disabled={!current || unsynced}
              title={
                unsynced ? "History starts once the note has synced" : "What changed, and when"
              }
              onClick={() => void toggleHistory()}
            >
              History
            </button>
            <button className="ghost danger" title="Delete" onClick={remove}>
              🗑
            </button>
          </header>
          {showHistory && current ? (
            <History key={current.id} noteId={current.id} onRestore={restore} />
          ) : (
            <>
              <input
                className="tagsInput"
                placeholder="tags, comma separated"
                value={draft.tags}
                onChange={(e) => edit({ tags: e.target.value })}
              />
              <textarea
                ref={bodyRef}
                placeholder="Write anything. Markdown welcome."
                value={draft.body}
                onChange={(e) => edit({ body: e.target.value })}
              />
            </>
          )}
          <footer className="foot">
            <span>
              {current ? `by ${current.author} · created ${ago(current.created_at)}` : "new note"}
            </span>
            {/* Announced, since it can say an edit is only on this device or conflicted. */}
            <output>{saveLabel}</output>
          </footer>
        </main>
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

function TokenDialog({ onSave }: { onSave: (token: string) => void }) {
  const [value, setValue] = useState("");
  // The dialog blocks the whole app, so moving focus into it is expected (unlike autoFocus on a page).
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  return (
    <div className="overlay">
      <form
        className="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (value) onSave(value);
        }}
      >
        <p>This scratchpad requires an access token.</p>
        <input
          ref={input}
          type="password"
          placeholder="PAD_TOKEN"
          aria-label="Access token"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button className="primary">Save</button>
      </form>
    </div>
  );
}

// WAI-ARIA's window splitter is a focusable separator carrying a value, so keyboard and screen
// reader users can resize the list too; jsx-a11y treats every separator as non-interactive.
/* oxlint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
function Splitter({ width, onChange }: { width: number; onChange: (width: number) => void }) {
  // The sidebar starts at the left edge, so the pointer's x is the new width.
  const drag = (e: React.PointerEvent<HTMLHRElement>) => {
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => onChange(clampWidth(ev.clientX));
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  };
  const key = (e: React.KeyboardEvent) => {
    const step = { ArrowLeft: -20, ArrowRight: 20 }[e.key];
    if (step) {
      e.preventDefault();
      onChange(clampWidth(width + step));
    }
  };
  return (
    <hr
      className="resize"
      aria-orientation="vertical"
      aria-label="Resize note list"
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={drag}
      onKeyDown={key}
    />
  );
}
/* oxlint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
