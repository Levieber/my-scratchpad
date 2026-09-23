import { join } from "node:path";

import type { BunRequest } from "bun";

import { config } from "./config";
import { type NoteInput, Store } from "./db";
import { ERROR_MESSAGES, type ErrorBody, type ErrorCode } from "./errors";
import { llmsTxt, openapi } from "./openapi";
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
  const { title, body: text, tags, pinned } = body as Record<string, unknown>;
  if (title !== undefined && typeof title !== "string")
    throw new HttpError("invalidBody", 400, "title must be a string");
  if (text !== undefined && typeof text !== "string")
    throw new HttpError("invalidBody", 400, "body must be a string");
  if (tags !== undefined && (!Array.isArray(tags) || !tags.every((t) => typeof t === "string"))) {
    throw new HttpError("invalidBody", 400, "tags must be an array of strings");
  }
  if (pinned !== undefined && typeof pinned !== "boolean")
    throw new HttpError("invalidBody", 400, "pinned must be a boolean");
  return { title, body: text, tags, pinned };
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
  const id = (req: BunRequest) => req.params.id ?? "";

  return {
    "/api/health": resource({ GET: () => json({ ok: true }) }, { auth: false }),

    "/api/notes": resource({
      GET: (req) => {
        const p = new URL(req.url).searchParams;
        const pinned = p.get("pinned");
        return json(
          store.list({
            q: p.get("q") ?? undefined,
            tag: p.get("tag") ?? undefined,
            pinned: pinned === null ? undefined : pinned === "true",
            limit: Number(p.get("limit") ?? 50) || 50,
            offset: Number(p.get("offset") ?? 0) || 0,
          }),
        );
      },
      POST: async (req) => {
        const input = await readInput(req);
        if (!input.body?.trim() && !input.title?.trim()) throw new HttpError("emptyNote", 400);
        const author = req.headers.get("x-pad-author")?.trim().slice(0, 64) || "human";
        return json(store.create(input, author), 201);
      },
    }),

    "/api/notes/:id": resource({
      GET: (req) => json(noteOr404(store.get(id(req)))),
      PATCH: async (req) => json(noteOr404(store.update(id(req), await readInput(req)))),
      DELETE: (req) => {
        if (!store.delete(id(req))) throw new HttpError("noteNotFound", 404);
        return new Response(null, { status: 204 });
      },
    }),

    "/api/notes/:id/append": resource({
      POST: async (req) => {
        const text = await readAppendText(req);
        if (!text) throw new HttpError("emptyAppend", 400);
        return json(noteOr404(store.append(id(req), text)));
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
