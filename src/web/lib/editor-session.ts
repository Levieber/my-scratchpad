// The open note: what the editor shows, autosaving it through the outbox, and what the server
// answers for it. A plain class, like Outbox and Syncer, so it is tested without React; the editor
// reads it through useEditor (hooks/use-editor.ts).
import type { FullRevision, Note } from "@/web/lib/api";
import { type Draft, emptyDraft, fromDraft, type SaveState, toDraft } from "@/web/lib/draft";
import { baseOf, fieldsOf, type Outbox } from "@/web/lib/outbox";
import { localNote } from "@/web/lib/pending";
import { mergeFields, type Outcome, type SyncResult, type Syncer } from "@/web/lib/sync";

export type EditorState = {
  /** Whether the editor is showing at all. */
  open: boolean;
  /** The saved note; null for a new note not saved yet. */
  current: Note | null;
  /** What the form holds. */
  draft: Draft;
  saveState: SaveState;
  saveError: string;
  showHistory: boolean;
};

type Deps = {
  outbox: Outbox;
  syncer: Syncer;
  newId: () => string;
  /** Called after each sync run: the app asks for a token, or refreshes what it shows. */
  onSynced?: (result: SyncResult) => void;
  autosaveMs?: number;
};

export class EditorSession {
  /**
   * What timers and beforeunload read: always the newest value, written synchronously, never
   * waiting for a render. React gets a copy of it in the snapshot.
   */
  private latest = { current: null as Note | null, draft: emptyDraft, dirty: false };
  private ui = { open: false, saveState: "" as SaveState, saveError: "", showHistory: false };
  private snapshot: EditorState = this.state();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<() => void>();
  private outbox: Outbox;
  private syncer: Syncer;
  private newId: () => string;
  private onSynced: (result: SyncResult) => void;
  private autosaveMs: number;

  constructor({ outbox, syncer, newId, onSynced = () => {}, autosaveMs = 600 }: Deps) {
    this.outbox = outbox;
    this.syncer = syncer;
    this.newId = newId;
    this.onSynced = onSynced;
    this.autosaveMs = autosaveMs;
    syncer.onSettled(this.settled);
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };

  getSnapshot = () => this.snapshot;

  /** Sends the outbox. What the server answers for the open note arrives through `settled`. */
  sync = async () => {
    const open = this.latest.current;
    if (open && this.outbox.get(open.id)) this.set({ saveState: "saving" });
    const result = await this.syncer.run();
    const cur = this.latest.current;
    if (cur && this.outbox.get(cur.id) && !this.latest.dirty) {
      if (result.status === "offline") this.set({ saveState: "local" });
      if (result.status === "error") this.set({ saveError: result.message, saveState: "error" });
    }
    this.onSynced(result);
    return result;
  };

  private settled = ({ sent, note, merged, conflict }: Outcome) => {
    const l = this.latest;
    if (!note || sent.op !== "save" || l.current?.id !== note.id) return;
    const waiting = this.outbox.get(note.id);
    // A newer edit still waiting was typed on top of this one; it carries the merge onward.
    if (!waiting && merged) {
      // Typing since the save started from what was sent, so it merges into the result too.
      const next = l.dirty
        ? mergeFields(sent.fields, fromDraft(l.draft), note).fields
        : fieldsOf(note);
      l.draft = toDraft(next);
    }
    l.current = note;
    if (!waiting)
      this.ui.saveState = conflict ? "conflict" : merged ? "merged" : l.dirty ? "pending" : "saved";
    this.emit();
  };

  /** Queues what the editor shows. Synchronous, so a tab being closed still keeps the edit. */
  commit = () => {
    const l = this.latest;
    clearTimeout(this.timer);
    if (!l.dirty) return;
    l.dirty = false;
    const { current, draft } = l;
    if (!current && !draft.body.trim() && !draft.title.trim()) return;
    const fields = fromDraft(draft);
    if (current) {
      this.outbox.save(current.id, fields, baseOf(current));
    } else {
      // A new note gets its id here, so it can be edited, listed and deleted before it syncs.
      const note = localNote(this.newId(), fields);
      l.current = note;
      this.emit();
      this.outbox.save(note.id, fields, null);
    }
  };

  save = async () => {
    this.commit();
    await this.sync();
  };

  /** A change in the form; saved once typing pauses. */
  edit = (patch: Partial<Draft>) => {
    this.latest.draft = { ...this.latest.draft, ...patch };
    this.latest.dirty = true;
    this.ui.saveState = "pending";
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.save(), this.autosaveMs);
    this.emit();
  };

  /** Leaving a note never waits for the network: the edit is safe in the outbox either way. */
  flush = () => {
    if (!this.latest.dirty) return;
    this.commit();
    void this.sync();
  };

  /**
   * Opens the note `load` reads (from the server, or what this device knows), as the outbox has
   * it if an edit is waiting. A failure to load is the caller's.
   */
  open = async (load: () => Promise<Note>) => {
    this.flush();
    const note = await load();
    const waiting = this.outbox.get(note.id);
    this.display(note, toDraft(waiting?.op === "save" ? waiting.fields : note));
    this.set({ saveState: waiting ? "local" : "" });
  };

  /** A new note, empty or holding `body`. */
  create = (body = "") => {
    this.flush();
    this.display(null, { ...emptyDraft, body });
    this.set({ saveState: "" });
  };

  /** A new note holding what another app shared, saved straight away. */
  share = (text: string) => {
    this.create(text);
    this.latest.dirty = true;
    return this.save();
  };

  private display(note: Note | null, draft: Draft) {
    this.latest.current = note;
    this.latest.draft = draft;
    this.ui.showHistory = false;
    this.ui.open = true;
    this.emit();
  }

  close = () => {
    this.flush();
    this.set({ open: false });
  };

  /** Deletes `note`, or the open one (which may be a new note never saved). */
  remove = (note = this.latest.current) => {
    if (!note || note.id === this.latest.current?.id) {
      clearTimeout(this.timer);
      this.latest.dirty = false;
      this.latest.current = null;
      this.set({ open: false });
    }
    if (note) {
      this.outbox.delete(note.id);
      void this.sync();
    }
  };

  toggleHistory = async () => {
    if (this.ui.showHistory) return this.set({ showHistory: false });
    // So the latest revision is what's on screen.
    this.commit();
    await this.sync();
    this.set({ showHistory: true });
  };

  restore = (r: FullRevision) => {
    this.ui.showHistory = false;
    this.edit({ title: r.title, body: r.body, tags: r.tags.join(", "), kind: r.kind });
  };

  /**
   * The server's copy of the open note, from a refresh: it replaces what the editor shows only if
   * it is newer (an answer can arrive late, after a save already moved the note on) and nothing
   * here is waiting to be saved.
   */
  receive = (fresh: Note) => {
    const { current, dirty } = this.latest;
    if (!current || fresh.id !== current.id || dirty || this.outbox.get(current.id)) return;
    if (Date.parse(fresh.updated_at) <= Date.parse(current.updated_at)) return;
    this.latest.current = fresh;
    this.latest.draft = toDraft(fresh);
    this.emit();
  };

  private set(patch: Partial<typeof this.ui>) {
    Object.assign(this.ui, patch);
    this.emit();
  }

  private state(): EditorState {
    return { ...this.ui, current: this.latest.current, draft: this.latest.draft };
  }

  private emit() {
    this.snapshot = this.state();
    this.listeners.forEach((fn) => fn());
  }
}
