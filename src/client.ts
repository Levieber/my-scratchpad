// Thin typed client over the HTTP API. The CLI and MCP server both use this — never the DB directly.
import { config } from "./config";
import type { ListQuery, Note, NoteInput } from "./db";
import { readError } from "./errors";

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

  list(q: ListQuery = {}) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(q))
      if (v !== undefined && v !== "") params.set(k, String(v));
    const qs = params.toString();
    return this.req<Note[]>("GET", `/api/notes${qs ? "?" + qs : ""}`);
  }
  get = (id: string) => this.req<Note>("GET", `/api/notes/${encodeURIComponent(id)}`);
  create = (input: NoteInput) => this.req<Note>("POST", "/api/notes", input);
  update = (id: string, patch: NoteInput) =>
    this.req<Note>("PATCH", `/api/notes/${encodeURIComponent(id)}`, patch);
  append = (id: string, text: string) =>
    this.req<Note>("POST", `/api/notes/${encodeURIComponent(id)}/append`, { text });
  delete = (id: string) => this.req<void>("DELETE", `/api/notes/${encodeURIComponent(id)}`);
  tags = () => this.req<{ tag: string; count: number }[]>("GET", "/api/tags");
  health = () => this.req<{ ok: boolean }>("GET", "/api/health");
}
