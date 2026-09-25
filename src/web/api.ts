// Browser client for the same HTTP API the CLI and agents use.
import type { Note, NoteInput } from "../db";
import { readError } from "../errors";

export type { Note, NoteInput };
export type Tag = { tag: string; count: number };

export class Unauthorized extends Error {}

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

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "x-pad-author": "human" };
  const t = token.get();
  if (t) headers.authorization = `Bearer ${t}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) throw new Unauthorized();
  if (res.status === 204) return undefined as T;
  const data = await res.json();
  if (!res.ok) {
    const { code, message } = readError(data);
    throw new Error(message ?? code ?? res.statusText);
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
  update: (id: string, patch: NoteInput) => req<Note>("PATCH", `/api/notes/${id}`, patch),
  delete: (id: string) => req<void>("DELETE", `/api/notes/${id}`),
  tags: () => req<Tag[]>("GET", "/api/tags"),
};
