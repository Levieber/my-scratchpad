// Browser client for the same HTTP API the CLI and agents use.
import type { FullRevision, Note, NoteInput, Revision } from "../db";
import { readError } from "../errors";
import type { NoteDiff } from "../server";

export type { FullRevision, Note, NoteDiff, NoteInput, Revision };
export type Tag = { tag: string; count: number };

export class Unauthorized extends Error {}

/** The server couldn't be reached, and the service worker had nothing cached for the request. */
export class Offline extends Error {}

export class ApiError extends Error {
  constructor(
    public status: number,
    /** The API's stable error code (src/errors.ts). */
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
  list: (q: { q?: string; kind?: string; limit?: number }) => {
    const p = new URLSearchParams();
    if (q.q) p.set("q", q.q);
    if (q.kind) p.set("kind", q.kind);
    if (q.limit) p.set("limit", String(q.limit));
    return req<Note[]>("GET", `/api/notes?${p}`);
  },
  get: (id: string) => req<Note>("GET", `/api/notes/${id}`),
  create: (input: NoteInput) => req<Note>("POST", "/api/notes", input),
  /** With `ifMatch` (the updated_at the edit started from), refused if the note changed since. */
  update: (id: string, patch: NoteInput, ifMatch?: string) =>
    req<Note>("PATCH", `/api/notes/${id}`, patch, ifMatch ? { "if-match": `"${ifMatch}"` } : {}),
  delete: (id: string) => req<void>("DELETE", `/api/notes/${id}`),
  daily: (date: string) => req<Note>("PUT", `/api/daily/${date}`),
  tags: () => req<Tag[]>("GET", "/api/tags"),
  revisions: (id: string) => req<Revision[]>("GET", `/api/notes/${id}/revisions?limit=100`),
  revision: (id: string, rev: number) =>
    req<FullRevision>("GET", `/api/notes/${id}/revisions/${rev}`),
  diff: (id: string, to: number) => req<NoteDiff>("GET", `/api/notes/${id}/diff?to=${to}`),
};
