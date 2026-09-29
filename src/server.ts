import { join } from "node:path";

import type { BunRequest } from "bun";

import { config } from "./config";
import { isDate } from "./daily";
import {
  type FullRevision,
  type ListQuery,
  type Note,
  type NoteInput,
  type Revision,
  Store,
} from "./db";
import { unifiedDiff } from "./diff";
import { ERROR_MESSAGES, type ErrorBody, type ErrorCode } from "./errors";
import { isNoteId } from "./ids";
import { isKind, KIND_NAMES } from "./kinds";
import { llmsTxt, openapi } from "./openapi";
import { parseQuery } from "./query";
import homepage from "./web/index.html";

const PUBLIC_DIR = join(import.meta.dir, "..", "public");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

type Method = (typeof METHODS)[number];
type Handler = (req: BunRequest) => Response | Promise<Response>;

class HttpError extends Error {
  constructor(
    public code: ErrorCode,
    public status: number,
    detail?: string,
  ) {
    super(detail ?? ERROR_MESSAGES[code]);
  }
}

const json = (data: unknown, status = 200) => Response.json(data, { status });
// The note's updated_at is its version: what If-Match compares against.
const noteJson = (note: Note, status = 200) =>
  Response.json(note, { status, headers: { etag: `"${note.updated_at}"` } });
const fail = (
  code: ErrorCode,
  status: number,
  message: string = ERROR_MESSAGES[code],
  headers?: HeadersInit,
) => Response.json({ error: code, message } satisfies ErrorBody, { status, headers });

async function readInput(req: Request): Promise<NoteInput> {
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) {
    // Anything else (text/plain, curl -d default form encoding) is treated as the raw body.
    return { body: await req.text() };
  }
  const body: unknown = await req.json().catch(() => {
    throw new HttpError("invalidJson", 400);
  });
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new HttpError("invalidBody", 400, "Expected a JSON object");
  const { id, title, body: text, tags, pinned, kind } = body as Record<string, unknown>;
  if (id !== undefined && !isNoteId(id))
    throw new HttpError("invalidBody", 400, "id must be 8-64 letters, digits, '-' or '_'");
  if (title !== undefined && typeof title !== "string")
    throw new HttpError("invalidBody", 400, "title must be a string");
  if (text !== undefined && typeof text !== "string")
    throw new HttpError("invalidBody", 400, "body must be a string");
  if (tags !== undefined && (!Array.isArray(tags) || !tags.every((t) => typeof t === "string"))) {
    throw new HttpError("invalidBody", 400, "tags must be an array of strings");
  }
  if (pinned !== undefined && typeof pinned !== "boolean")
    throw new HttpError("invalidBody", 400, "pinned must be a boolean");
  if (kind !== undefined && !isKind(kind)) throw kindError();
  return { id, title, body: text, tags, pinned, kind };
}

/** If-Match against a note: its updated_at, quoted as in the ETag or bare, or `*` for any. */
function matches(header: string | null, note: Note): boolean {
  if (header === null) return true;
  const tags = header.split(",").map((t) =>
    t
      .trim()
      .replace(/^W\//, "")
      .replace(/^"(.*)"$/, "$1"),
  );
  return tags.includes("*") || tags.includes(note.updated_at);
}

const positiveInt = (p: URLSearchParams, name: string): number | undefined => {
  const value = p.get(name);
  if (value === null) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0)
    throw new HttpError("invalidParam", 400, `${name} must be a revision id`);
  return n;
};

/** `GET /api/notes/:id/diff`: `from` null means compared with an empty note. */
export type NoteDiff = {
  note_id: string;
  from: Revision | null;
  to: Revision;
  changes: Partial<Record<"title" | "tags" | "kind", { from: unknown; to: unknown }>>;
  diff: string;
};

const withoutBody = (full: FullRevision): Revision => {
  const { body: _, ...revision } = full;
  return revision;
};

/** Which of the fields besides the body differ between two revisions (`from` null: none yet). */
function fieldChanges(from: FullRevision | null, to: FullRevision) {
  const changes: NoteDiff["changes"] = {};
  for (const field of ["title", "tags", "kind"] as const) {
    const before = from ? from[field] : null;
    if (JSON.stringify(before) !== JSON.stringify(to[field]))
      changes[field] = { from: before, to: to[field] };
  }
  return changes;
}

const revisionLabel = (r: FullRevision | null) =>
  r ? `revision ${r.id} (${r.updated_at}, ${r.author})` : "empty";

const authorOf = (req: Request) => req.headers.get("x-pad-author")?.trim().slice(0, 64) || "human";

const kindError = () =>
  new HttpError("invalidKind", 400, `kind must be one of: ${KIND_NAMES.join(", ")}`);

/**
 * The list's query string as a store query. An explicit `kind` parameter is checked, since a
 * program sent it; one typed into `q` is not, so a half-typed search just matches nothing.
 */
function readListQuery(p: URLSearchParams): ListQuery {
  const kind = p.get("kind");
  if (kind !== null && !isKind(kind)) throw kindError();
  const parsed = parseQuery(p.get("q") ?? "");
  const pinned = p.get("pinned");
  return {
    q: parsed.text || undefined,
    kind: kind ?? parsed.kind,
    tags: [...p.getAll("tag"), ...parsed.tags],
    pinned: pinned === null ? undefined : pinned === "true",
    limit: Number(p.get("limit") ?? 50) || 50,
    offset: Number(p.get("offset") ?? 0) || 0,
  };
}

async function readAppendText(req: Request): Promise<string> {
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) return req.text();
  const body: unknown = await req.json().catch(() => {
    throw new HttpError("invalidJson", 400);
  });
  const text = body && typeof body === "object" && "text" in body ? body.text : undefined;
  if (text !== undefined && typeof text !== "string")
    throw new HttpError("invalidBody", 400, "text must be a string");
  return text ?? "";
}

const staticFile =
  (name: string, headers: Record<string, string> = {}): Handler =>
  () =>
    new Response(Bun.file(join(PUBLIC_DIR, name)), { headers });

/** The route table for `Bun.serve`: one entry per path, one handler per method. */
export function createRoutes(store: Store, { token }: { token?: string } = {}) {
  const authorized = (req: Request) =>
    !token || req.headers.get("authorization") === `Bearer ${token}`;

  // Wraps a handler with the bearer check and turns thrown HttpErrors into error responses.
  const guard =
    (handler: Handler, { auth = true } = {}): Handler =>
    async (req) => {
      try {
        if (auth && !authorized(req)) throw new HttpError("unauthorized", 401);
        return await handler(req);
      } catch (e) {
        if (e instanceof HttpError) return fail(e.code, e.status, e.message);
        console.error(e);
        return fail("internal", 500);
      }
    };

  // A path's handlers, with 405 + Allow for every method it doesn't define (Bun would 404 them).
  const resource = (handlers: Partial<Record<Method, Handler>>, opts?: { auth?: boolean }) => {
    const allow = Object.keys(handlers).join(", ");
    return Object.fromEntries(
      METHODS.map((m) => {
        const handler = handlers[m];
        return [
          m,
          handler
            ? guard(handler, opts)
            : () => fail("methodNotAllowed", 405, undefined, { allow }),
        ];
      }),
    );
  };

  const noteOr404 = <T>(value: T | null): T => {
    if (value === null) throw new HttpError("noteNotFound", 404);
    return value;
  };
  const revisionOr404 = <T>(value: T | null): T => {
    if (value === null) throw new HttpError("revisionNotFound", 404);
    return value;
  };
  const id = (req: BunRequest) => req.params.id ?? "";

  /**
   * Two revisions of a note: `to` (default the latest) against `from` (default the one before
   * `to`), or against the note as it was at `since`, to see what changed after a given time.
   */
  const diff = (noteId: string, p: URLSearchParams): NoteDiff => {
    noteOr404(store.get(noteId));
    const fromId = positiveInt(p, "from");
    const toId = positiveInt(p, "to");
    const sinceParam = p.get("since");
    if (sinceParam !== null && fromId !== undefined)
      throw new HttpError("invalidParam", 400, "Pass either from or since, not both");
    const sinceTime = sinceParam === null ? undefined : Date.parse(sinceParam);
    if (sinceTime !== undefined && Number.isNaN(sinceTime))
      throw new HttpError("invalidParam", 400, "since must be an ISO date-time");

    const to = revisionOr404(
      toId === undefined ? store.latestRevision(noteId) : store.revision(noteId, toId),
    );
    const from =
      fromId !== undefined
        ? revisionOr404(store.revision(noteId, fromId))
        : sinceTime !== undefined
          ? store.latestRevision(noteId, new Date(sinceTime).toISOString())
          : store.previousRevision(noteId, to.id);
    const body = unifiedDiff(from?.body ?? "", to.body, [revisionLabel(from), revisionLabel(to)]);
    return {
      note_id: noteId,
      from: from && withoutBody(from),
      to: withoutBody(to),
      changes: fieldChanges(from, to),
      diff: body,
    };
  };

  return {
    "/api/health": resource({ GET: () => json({ ok: true }) }, { auth: false }),

    "/api/notes": resource({
      GET: (req) => json(store.list(readListQuery(new URL(req.url).searchParams))),
      POST: async (req) => {
        const input = await readInput(req);
        if (!input.body?.trim() && !input.title?.trim()) throw new HttpError("emptyNote", 400);
        // A client retrying a create whose response it never got learns it already succeeded.
        if (input.id !== undefined && store.get(input.id)) throw new HttpError("noteExists", 409);
        return noteJson(store.create(input, authorOf(req)), 201);
      },
    }),

    "/api/notes/:id": resource({
      GET: (req) => noteJson(noteOr404(store.get(id(req)))),
      PATCH: async (req) => {
        const { id: _, ...patch } = await readInput(req);
        // Checked and written with no await in between, so no other write can slip past the check.
        const cur = noteOr404(store.get(id(req)));
        if (!matches(req.headers.get("if-match"), cur)) throw new HttpError("noteChanged", 412);
        return noteJson(noteOr404(store.update(cur.id, patch, authorOf(req))));
      },
      DELETE: (req) => {
        if (!store.delete(id(req))) throw new HttpError("noteNotFound", 404);
        return new Response(null, { status: 204 });
      },
    }),

    "/api/notes/:id/append": resource({
      POST: async (req) => {
        const text = await readAppendText(req);
        if (!text) throw new HttpError("emptyAppend", 400);
        return noteJson(noteOr404(store.append(id(req), text, authorOf(req))));
      },
    }),

    "/api/notes/:id/revisions": resource({
      GET: (req) => {
        noteOr404(store.get(id(req)));
        const p = new URL(req.url).searchParams;
        return json(
          store.revisions(id(req), {
            limit: Number(p.get("limit") ?? 50) || 50,
            offset: Number(p.get("offset") ?? 0) || 0,
          }),
        );
      },
    }),

    "/api/notes/:id/revisions/:rev": resource({
      GET: (req) => {
        noteOr404(store.get(id(req)));
        return json(revisionOr404(store.revision(id(req), Number(req.params.rev))));
      },
    }),

    "/api/notes/:id/diff": resource({
      GET: (req) => json(diff(id(req), new URL(req.url).searchParams)),
    }),

    // PUT because it is idempotent: asking for the same day twice returns the same note.
    "/api/daily/:date": resource({
      PUT: (req) => {
        const date = req.params.date ?? "";
        if (!isDate(date)) throw new HttpError("invalidDate", 400);
        const { note, created } = store.daily(date, authorOf(req));
        return noteJson(note, created ? 201 : 200);
      },
    }),

    "/api/tags": resource({ GET: () => json(store.tags()) }),

    "/api/*": () => fail("notFound", 404),

    "/openapi.json": () => json(openapi),
    "/llms.txt": (req: BunRequest) =>
      new Response(llmsTxt(new URL(req.url).origin), {
        headers: { "content-type": "text/plain; charset=utf-8" },
      }),

    // PWA files that must live at the root. The app itself is bundled from the HTML import.
    "/sw.js": staticFile("sw.js", { "cache-control": "no-cache" }),
    "/manifest.webmanifest": staticFile("manifest.webmanifest", {
      "content-type": "application/manifest+json",
    }),
    "/icon.svg": staticFile("icon.svg"),
    "/": homepage,
  };
}

type ServerOptions = {
  store: Store;
  token?: string;
  hostname?: string;
  port?: number;
  development?: boolean;
};

export function createServer({
  store,
  token,
  hostname = "127.0.0.1",
  port = 0,
  development = false,
}: ServerOptions) {
  return Bun.serve({
    hostname,
    port,
    routes: createRoutes(store, { token }),
    // Bun bundles the HTML import on the fly in development (with HMR, and browser console logs
    // streamed to the terminal); in production it bundles once at startup.
    development: development && { hmr: true, console: true },
    fetch: () => fail("notFound", 404),
  });
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

export function start() {
  if (!LOOPBACK.has(config.host) && !config.serverToken) {
    console.error(
      `Refusing to listen on ${config.host} without PAD_TOKEN. Set PAD_TOKEN to a long random secret.`,
    );
    process.exit(1);
  }
  const server = createServer({
    store: new Store(config.db),
    token: config.serverToken,
    hostname: config.host,
    port: config.port,
    development: process.env.NODE_ENV !== "production",
  });
  console.log(
    `scratchpad listening on ${server.url} (db: ${config.db}${config.serverToken ? ", token auth on" : ""})`,
  );
  return server;
}

if (import.meta.main) start();
