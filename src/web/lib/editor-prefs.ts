// How this device likes the editor: the mode an existing note opens in, and the Write view's font.
// Per-device conveniences, like the sidebar's width: storage failing (private mode) means the default.
import type { EditorMode } from "@/web/lib/editor-session";
import { Store } from "@/web/lib/store";

const MODE_KEY = "pad-editor-mode";
const FONT_KEY = "pad-editor-font";

export type EditorFont = "mono" | "sans";

const read = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return allowed.find((a) => a === v) ?? fallback;
  } catch {
    return fallback;
  }
};

const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {}
};

/** Existing notes open in Read until the person picks Write; then in what they picked last. */
export const editorModes = {
  initial: () => read<EditorMode>(MODE_KEY, ["read", "write"], "read"),
  chosen: (mode: EditorMode) => write(MODE_KEY, mode),
};

export const editorFont = new Store<EditorFont>(read(FONT_KEY, ["mono", "sans"], "mono"));
editorFont.subscribe(() => write(FONT_KEY, editorFont.get()));
