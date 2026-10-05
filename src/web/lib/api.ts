// Browser client for the same HTTP API the CLI and agents use.
import type { ExportArchive, ImportLimits, ImportResult } from "@/shared/archive";
import type {
  FullRevision,
  HookNotes,
  HookSelection,
  HooksInfo,
  Note,
  NoteDiff,
  NoteInput,
  NewView,
  Revision,
  View,
  ViewPatch,
} from "@/shared/domain";
import { readError } from "@/shared/errors";
import type { Location } from "@/shared/hooks";
import { exportPath } from "@/web/lib/transfer";

export type {
  FullRevision,
  HookSelection,
  HooksInfo,
  NewView,
  Note,
  NoteDiff,
  NoteInput,
  Revision,
  View,
  ViewPatch,
};
export type Tag = { tag: string; count: number };

export class Unauthorized extends Error {}

/** The server couldn't be reached, and the service worker had nothing cached for the request. */
export class Offline extends Error {}

export class ApiError extends Error {
  constructor(
    public status: number,
    /** The API's stable error code (shared/errors.ts). */
    public code: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

export const isApiError = (e: unknown, code: string) => e instanceof ApiError && e.code === code;

const TOKEN_KEY = "pad-token";

export const token = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (v: string) => {
    try {
      localStorage.setItem(TOKEN_KEY, v);
    } catch {}
  },
};

// Every request reports whether the server answered, so the app shows the connection as it is
// rather than guessing from navigator.onLine (which is true on a network with no route out).
const listeners = new Set<(online: boolean) => void>();
export function onConnectivity(fn: (online: boolean) => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
const report = (online: boolean) => listeners.forEach((fn) => fn(online));

async function req<T>(
  method: string,
  path: string,
  body?: unknown,
  extra: Record<string, string> = {},
): Promise<T> {
  const headers: Record<string, string> = { "x-pad-author": "human", ...extra };
  const t = token.get();
  if (t) headers.authorization = `Bearer ${t}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    report(false);
    throw new Offline();
  }
  // The service worker marks what it answered from its cache (public/sw.js).
  const cached = res.headers.has("x-pad-offline");
  report(!cached);
  if (cached && !res.ok) throw new Offline();
  if (res.status === 401) throw new Unauthorized();
  if (res.status === 204) return undefined as T;
  const data = await res.json();
  if (!res.ok) {
    const { code, message } = readError(data);
    throw new ApiError(res.status, code, message ?? code ?? res.statusText);
  }
  return data as T;
}

export const api = {
  // Kind, author and tags travel inside `q` as operators (shared/query.ts).
  /** `parent`: only the notes under that page; `none` for those at the top. */
  list: (q: { q?: string; parent?: string; limit?: number }) => {
    const p = new URLSearchParams();
    if (q.q) p.set("q", q.q);
    if (q.parent) p.set("parent", q.parent);
    if (q.limit) p.set("limit", String(q.limit));
    return req<Note[]>("GET", `/api/notes?${p}`);
  },
  get: (id: string) => req<Note>("GET", `/api/notes/${id}`),
  create: (input: NoteInput) => req<Note>("POST", "/api/notes", input),
  /** With `ifMatch` (the updated_at the edit started from), refused if the note changed since. */
  update: (id: string, patch: NoteInput, ifMatch?: string) =>
    req<Note>("PATCH", `/api/notes/${id}`, patch, ifMatch ? { "if-match": `"${ifMatch}"` } : {}),
  delete: (id: string) => req<void>("DELETE", `/api/notes/${id}`),
  tags: () => req<Tag[]>("GET", "/api/tags"),
  views: () => req<View[]>("GET", "/api/views"),
  createView: (view: NewView) => req<View>("POST", "/api/views", view),
  /** Send only what changed: options merge into the view's, so others' survive. */
  updateView: (id: string, patch: ViewPatch) => req<View>("PATCH", `/api/views/${id}`, patch),
  deleteView: (id: string) => req<void>("DELETE", `/api/views/${id}`),
  pins: () => req<Note[]>("GET", "/api/pins"),
  pin: (id: string) => req<void>("PUT", `/api/pins/${id}`),
  unpin: (id: string) => req<void>("DELETE", `/api/pins/${id}`),
  revisions: (id: string) => req<Revision[]>("GET", `/api/notes/${id}/revisions?limit=100`),
  revision: (id: string, rev: number) =>
    req<FullRevision>("GET", `/api/notes/${id}/revisions/${rev}`),
  diff: (id: string, to: number) => req<NoteDiff>("GET", `/api/notes/${id}/diff?to=${to}`),
  /** Every note a search lists (all, for none), with their history unless off. */
  exportArchive: (q: string, history: boolean) => req<ExportArchive>("GET", exportPath(q, history)),
  importLimits: () => req<ImportLimits>("GET", "/api/import"),
  importArchive: (archive: unknown) => req<ImportResult>("POST", "/api/import", archive),
  hooks: () => req<HooksInfo>("GET", "/api/hooks"),
  hookNotes: (hook: string, at: Location) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(at)) if (v) p.set(k, v);
    return req<HookNotes>("GET", `/api/hooks/${hook}/notes?${p}`);
  },
  saveHookSelection: (
    hook: string,
    selection: { scope: string; query?: string | null; limit?: number },
  ) => req<HookSelection>("PUT", `/api/hooks/${hook}`, selection),
  deleteHookSelection: (hook: string, scope: string) =>
    req<void>("DELETE", `/api/hooks/${hook}?${new URLSearchParams({ scope })}`),
  pickHookNote: (hook: string, id: string, scope = "") =>
    req<void>("PUT", `/api/hooks/${hook}/include/${id}?${new URLSearchParams({ scope })}`),
  unpickHookNote: (hook: string, id: string, scope = "") =>
    req<void>("DELETE", `/api/hooks/${hook}/include/${id}?${new URLSearchParams({ scope })}`),
};
