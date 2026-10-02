// Thin typed client over the HTTP API. The CLI and MCP server both use this — never the DB directly.
import { config } from "./config";
import type { FullRevision, Note, NoteInput, Revision, View } from "./db";
import { readError } from "./errors";
import type { NoteDiff } from "./server";

/** `GET /api/notes` parameters. `q` may carry `kind:x`, `author:x` and `#tag` operators. */
export type ListParams = {
  q?: string;
  kind?: string;
  /** `human`, `agent` (anyone else), or an author's name. */
  author?: string;
  /** Notes must carry every one of these. */
  tag?: string[];
  pinned?: boolean;
  limit?: number;
  offset?: number;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** The API's stable error code (see src/errors.ts), when the server sent one. */
    public code?: string,
  ) {
    super(message);
  }
}

export class Client {
  constructor(
    private base = config.url,
    private author = process.env.PAD_AUTHOR ?? "human",
    private token = config.token,
  ) {}

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { "x-pad-author": this.author };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    let res: Response;
    try {
      res = await fetch(this.base + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(
        0,
        `Scratchpad server not reachable at ${this.base}. Start it with \`pad serve\` or \`systemctl --user start scratchpad\`.`,
      );
    }
    if (res.status === 204) return undefined as T;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const { code, message } = readError(data);
      throw new ApiError(res.status, message ?? code ?? res.statusText, code);
    }
    return data as T;
  }

  list = (q: ListParams = {}) => this.req<Note[]>("GET", `/api/notes${query(q)}`);
  get = (id: string) => this.req<Note>("GET", `/api/notes/${encodeURIComponent(id)}`);
  create = (input: NoteInput) => this.req<Note>("POST", "/api/notes", input);
  update = (id: string, patch: NoteInput) =>
    this.req<Note>("PATCH", `/api/notes/${encodeURIComponent(id)}`, patch);
  append = (id: string, text: string) =>
    this.req<Note>("POST", `/api/notes/${encodeURIComponent(id)}/append`, { text });
  delete = (id: string) => this.req<void>("DELETE", `/api/notes/${encodeURIComponent(id)}`);
  /** The daily review for a local YYYY-MM-DD date, created on first request. */
  daily = (date: string) => this.req<Note>("PUT", `/api/daily/${encodeURIComponent(date)}`);
  tags = () => this.req<{ tag: string; count: number }[]>("GET", "/api/tags");
  views = () => this.req<View[]>("GET", "/api/views");
  createView = (name: string, query: string) =>
    this.req<View>("POST", "/api/views", { name, query });
  deleteView = (id: string) => this.req<void>("DELETE", `/api/views/${encodeURIComponent(id)}`);
  health = () => this.req<{ ok: boolean }>("GET", "/api/health");
  /** A note's history, newest first. */
  revisions = (id: string, q: { limit?: number; offset?: number } = {}) =>
    this.req<Revision[]>("GET", `/api/notes/${encodeURIComponent(id)}/revisions${query(q)}`);
  revision = (id: string, rev: number) =>
    this.req<FullRevision>("GET", `/api/notes/${encodeURIComponent(id)}/revisions/${rev}`);
  /** The latest change by default; `since` (ISO time) for everything changed after it. */
  diff = (id: string, q: { from?: number; to?: number; since?: string } = {}) =>
    this.req<NoteDiff>("GET", `/api/notes/${encodeURIComponent(id)}/diff${query(q)}`);
}

function query(q: Record<string, string | number | boolean | string[] | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q))
    for (const one of [v].flat())
      if (one !== undefined && one !== "") params.append(k, String(one));
  const qs = params.toString();
  return qs ? "?" + qs : "";
}
