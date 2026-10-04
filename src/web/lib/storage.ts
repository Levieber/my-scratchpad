// What this browser remembers: the sidebar's width, and the outbox of edits the server doesn't
// have yet.
import { api } from "@/web/lib/api";
import { Outbox } from "@/web/lib/outbox";
import { Syncer } from "@/web/lib/sync";

const WIDTH_KEY = "pad-sidebar-width";
const DEFAULT_WIDTH = 360;
export const MIN_WIDTH = 260;
export const MAX_WIDTH = 560;

export const clampWidth = (w: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(w)));

// The width is a per-device convenience, so storage failing (private mode) just means the default.
export const storedWidth = () => {
  try {
    const w = Number(localStorage.getItem(WIDTH_KEY));
    return w ? clampWidth(w) : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
};

export const storeWidth = (width: number) => {
  try {
    localStorage.setItem(WIDTH_KEY, String(width));
  } catch {}
};

// Private mode can refuse storage; the outbox then lasts as long as the tab.
const browserStorage = () => {
  try {
    return localStorage;
  } catch {
    return null;
  }
};

export const outbox = new Outbox(browserStorage());
export const syncer = new Syncer(outbox, api);
