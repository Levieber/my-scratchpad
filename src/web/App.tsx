import { useCallback, useEffect, useRef, useState } from "react";

import type { Kind } from "../kinds";
import { hasToken, parseQuery, toggleToken } from "../query";
import { api, token, Unauthorized, type Note, type Tag } from "./api";
import { groupNotes, preview, visibleTags } from "./listing";

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

type Draft = { title: string; body: string; tags: string; pinned: boolean; kind: Kind };

const emptyDraft: Draft = { title: "", body: "", tags: "", pinned: false, kind: "note" };
const toDraft = (n: Note): Draft => ({
  title: n.title,
  body: n.body,
  tags: n.tags.join(", "),
  pinned: n.pinned,
  kind: n.kind,
});
const fromDraft = (d: Draft) => ({
  title: d.title,
  body: d.body,
  tags: d.tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean),
  pinned: d.pinned,
  kind: d.kind,
});

const ago = (iso: string) => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
};

type SaveState = "" | "pending" | "saving" | "saved" | "error";

export function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<Kind | "">("");
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

  // Refs so timers/intervals see the latest values without re-subscribing.
  const latest = useRef({ current, draft, dirty: false, saving: null as Promise<void> | null });
  latest.current.current = current;
  latest.current.draft = draft;

  const handle = useCallback((e: unknown) => {
    if (e instanceof Unauthorized) setNeedsToken(true);
    else setOnline(false);
  }, []);

  const refreshList = useCallback(async () => {
    try {
      const [n, t] = await Promise.all([api.list({ q, kind, limit }), api.tags()]);
      setNotes(n);
      setTags(t);
      setOnline(true);
      return n;
    } catch (e) {
      handle(e);
    }
  }, [q, kind, limit, handle]);

  const save = useCallback(async () => {
    const l = latest.current;
    if (l.saving) await l.saving;
    const { current, draft } = latest.current;
    if (!current && !draft.body.trim() && !draft.title.trim()) return;
    l.dirty = false;
    setSaveState("saving");
    l.saving = (async () => {
      try {
        const note = current
          ? await api.update(current.id, fromDraft(draft))
          : await api.create(fromDraft(draft));
        setCurrent(note);
        latest.current.current = note;
        setSaveState(latest.current.dirty ? "pending" : "saved");
        setOnline(true);
        void refreshList();
      } catch (e) {
        l.dirty = true;
        setSaveState("error");
        handle(e);
      }
    })();
    await l.saving;
    l.saving = null;
  }, [refreshList, handle]);

  // Debounced autosave.
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const edit = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    latest.current.dirty = true;
    setSaveState("pending");
    clearTimeout(timer.current);
    timer.current = setTimeout(save, 600);
  };
  const flush = async () => {
    clearTimeout(timer.current);
    if (latest.current.dirty) await save();
  };

  const openNote = async (id: string) => {
    await flush();
    try {
      const n = await api.get(id);
      setCurrent(n);
      setDraft(toDraft(n));
      setSaveState("");
      setOpen(true);
    } catch (e) {
      handle(e);
    }
  };

  const newNote = async (body = "") => {
    await flush();
    setCurrent(null);
    setDraft({ ...emptyDraft, body });
    setSaveState("");
    setOpen(true);
  };

  const remove = async () => {
    if (current && !confirm(`Delete "${current.title}"?`)) return;
    clearTimeout(timer.current);
    latest.current.dirty = false;
    if (current) await api.delete(current.id).catch(handle);
    setCurrent(null);
    setOpen(false);
    void refreshList();
  };

  // Search / tag filter.
  useEffect(() => {
    const t = setTimeout(refreshList, 200);
    return () => clearTimeout(t);
  }, [refreshList]);

  // Poll so notes written by agents or the CLI show up live; reload the open note if it changed remotely.
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const tick = async () => {
      if (document.hidden) return;
      const list = await refreshList();
      const { current, dirty, saving } = latest.current;
      if (!list || !current || dirty || saving || document.activeElement === bodyRef.current)
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
  }, [refreshList]);

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
        clearTimeout(timer.current);
        void save();
      }
    };
    const onUnload = () => latest.current.dirty && save();
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

  const filter = (next: { q?: string; kind?: Kind | "" }) => {
    if (next.q !== undefined) setQ(next.q);
    if (next.kind !== undefined) setKind(next.kind);
    setLimit(PAGE);
  };

  // Tag chips edit the search box, so several tags combine and the query stays visible.
  const selectedTags = parseQuery(q).tags;
  const shownTags = allTags ? tags : visibleTags(tags, selectedTags, TAG_LIMIT);

  const saveLabel = {
    "": "",
    pending: "…",
    saving: "saving…",
    saved: "saved",
    error: "not saved — offline?",
  }[saveState];

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
          onChange={(e) => filter({ q: e.target.value })}
        />
        <fieldset className="kinds" aria-label="Kind">
          {(
            [
              ["", "All"],
              ["reference", "Reference"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} aria-pressed={kind === k} onClick={() => filter({ kind: k })}>
              {label}
            </button>
          ))}
        </fieldset>
        {tags.length > 0 && (
          <div className="tags">
            {shownTags.map((t) => (
              <button
                key={t.tag}
                aria-pressed={hasToken(q, `#${t.tag}`)}
                onClick={() => filter({ q: toggleToken(q, `#${t.tag}`) })}
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
          {groupNotes(notes).map((g) => (
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
                          {ago(n.updated_at)}
                          {n.kind === "reference" && !kind && (
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
          {notes.length === 0 && <p className="m">{q || kind ? "No matches." : "No notes yet."}</p>}
          {notes.length >= limit && (
            <button className="more" onClick={() => setLimit((l) => l + PAGE)}>
              Load more
            </button>
          )}
        </nav>
        <footer className="foot">
          <span className={online ? "status" : "status off"}>{online ? "online" : "offline"}</span>
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
              onClick={() => flush().then(() => setOpen(false))}
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
              className="ghost"
              aria-pressed={draft.pinned}
              title="Pin"
              onClick={() => edit({ pinned: !draft.pinned })}
            >
              {draft.pinned ? "★" : "☆"}
            </button>
            <button className="ghost danger" title="Delete" onClick={remove}>
              🗑
            </button>
          </header>
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
          <footer className="foot">
            <span>
              {current ? `by ${current.author} · created ${ago(current.created_at)}` : "new note"}
            </span>
            <span>{saveLabel}</span>
          </footer>
        </main>
      )}

      {needsToken && (
        <TokenDialog
          onSave={(t) => {
            token.set(t);
            setNeedsToken(false);
            void refreshList();
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
