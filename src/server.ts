import { join } from "node:path";

import * as BunHttpServer from "@effect/platform-bun/BunHttpServer";
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type * as HttpPlatform from "effect/http/HttpPlatform";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServer from "effect/http/HttpServer";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { ServerConfig } from "./config";
import {
  type ListQuery,
  type NoteChanged,
  type NoteExists,
  type NoteNotFound,
  RevisionNotFound,
  Store,
  type ViewExists,
  type ViewNotFound,
} from "./db";
import { unifiedDiff } from "./diff";
import {
  type FullRevision,
  inputProblem,
  failedField,
  type Note,
  NoteInput,
  type NoteDiff,
  withoutBody,
} from "./domain";
import { ERROR_MESSAGES, type ErrorBody, type ErrorCode } from "./errors";
import { isKind, KIND_NAMES } from "./kinds";
import { llmsTxt, openapi } from "./openapi";
import { parseQuery } from "./query";
import homepage from "./web/index.html";

const PUBLIC_DIR = join(import.meta.dir, "..", "public");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

type Method = (typeof METHODS)[number];
type Request = HttpServerRequest.HttpServerRequest;

/** A request the API refuses, answered as `{ error: code, message }` with `status`. */
class HttpError extends Data.TaggedError("HttpError")<{
  code: ErrorCode;
  status: number;
  message: string;
}> {}

/** Everything a handler may fail with; each becomes an error response in `guard`. */
type Failure =
  | HttpError
  | NoteNotFound
  | NoteExists
  | NoteChanged
  | RevisionNotFound
  | ViewNotFound
  | ViewExists;

/** A route's handler: it reads the request and its route params, nothing else per request. */
type Handler = Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  Failure,
  HttpServerRequest.HttpServerRequest | HttpRouter.RouteContext
>;

const refuse = (code: ErrorCode, status: number, detail?: string) =>
  new HttpError({ code, status, message: detail ?? ERROR_MESSAGES[code] });

const json = (data: unknown, status = 200) => HttpServerResponse.jsonUnsafe(data, { status });
// The note's updated_at is its version: what If-Match compares against.
const noteJson = (note: Note, status = 200) =>
  HttpServerResponse.jsonUnsafe(note, { status, headers: { etag: `"${note.updated_at}"` } });
const errorJson = (
  code: ErrorCode,
  status: number,
  message: string = ERROR_MESSAGES[code],
  headers?: Record<string, string>,
) =>
  HttpServerResponse.jsonUnsafe({ error: code, message } satisfies ErrorBody, { status, headers });

const noContent = HttpServerResponse.empty({ status: 204 });

const isJson = (req: Request) => (req.headers["content-type"] ?? "").includes("application/json");

const readJson = (req: Request) => Effect.mapError(req.json, () => refuse("invalidJson", 400));

const kindError = () => refuse("invalidKind", 400, `kind must be one of: ${KIND_NAMES.join(", ")}`);

const decodeInput = Schema.decodeUnknownEffect(NoteInput);

const readInput = (req: Request) =>
  Effect.gen(function* () {
    // Anything else (text/plain, curl -d default form encoding) is treated as the raw body.
    if (!isJson(req)) return { body: yield* Effect.orDie(req.text) } satisfies NoteInput;
    const body = yield* readJson(req);
    // An unknown kind has its own code, so a client can tell it from a malformed body.
    return yield* Effect.mapError(decodeInput(body), (error) =>
      failedField(error) === "kind" ? kindError() : refuse("invalidBody", 400, inputProblem(error)),
    );
  });

const readAppendText = (req: Request) =>
  Effect.gen(function* () {
    if (!isJson(req)) return yield* Effect.orDie(req.text);
    const body = yield* readJson(req);
    const text = body && typeof body === "object" && "text" in body ? body.text : undefined;
    if (text !== undefined && typeof text !== "string")
      return yield* refuse("invalidBody", 400, "text must be a string");
    return text ?? "";
  });

/** If-Match against a note: its updated_at, quoted as in the ETag or bare, or `*` for any. */
function matches(header: string | undefined, note: Note): boolean {
  if (header === undefined) return true;
  const tags = header.split(",").map((t) =>
    t
      .trim()
      .replace(/^W\//, "")
      .replace(/^"(.*)"$/, "$1"),
  );
  return tags.includes("*") || tags.includes(note.updated_at);
}

const searchParams = (req: Request) => new URL(req.originalUrl).searchParams;

const positiveInt = (p: URLSearchParams, name: string) =>
  Effect.suspend(() => {
    const value = p.get(name);
    if (value === null) return Effect.succeed(undefined);
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0)
      return Effect.fail(refuse("invalidParam", 400, `${name} must be a revision id`));
    return Effect.succeed(n);
  });

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

const authorOf = (req: Request) => req.headers["x-pad-author"]?.trim().slice(0, 64) || "human";

const page = (p: URLSearchParams) => ({
  limit: Number(p.get("limit") ?? 50) || 50,
  offset: Number(p.get("offset") ?? 0) || 0,
});

/**
 * The list's query string as a store query. An explicit `kind` parameter is checked, since a
 * program sent it; one typed into `q` is not, so a half-typed search just matches nothing.
 */
const readListQuery = (p: URLSearchParams) =>
  Effect.suspend((): Effect.Effect<ListQuery, HttpError> => {
    const kind = p.get("kind");
    if (kind !== null && !isKind(kind)) return Effect.fail(kindError());
    const parsed = parseQuery(p.get("q") ?? "");
    return Effect.succeed({
      q: parsed.text || undefined,
      kind: kind ?? parsed.kind,
      author: p.get("author") ?? parsed.author,
      tags: [...p.getAll("tag"), ...parsed.tags],
      ...page(p),
    });
  });

const staticFile = (name: string, contentType?: string, headers: Record<string, string> = {}) =>
  HttpServerResponse.file(join(PUBLIC_DIR, name), { contentType, headers }).pipe(Effect.orDie);

const routeId = Effect.map(HttpRouter.params, (p) => p.id ?? "");

/** The API's routes, on the Store. With `token`, every route but the health check needs it. */
export const routes = (token: Redacted.Redacted | undefined) =>
  HttpRouter.addAll(
    Effect.gen(function* () {
      const store = yield* Store;

      const authorized = (req: Request) =>
        !token || req.headers.authorization === `Bearer ${Redacted.value(token)}`;

      // Turns refusals and the store's typed failures into error responses. Defects are bugs:
      // logged in full, answered with `internal`.
      const guard = (handler: Handler, { auth = true } = {}) =>
        Effect.gen(function* () {
          const req = yield* HttpServerRequest.HttpServerRequest;
          if (auth && !authorized(req)) return yield* refuse("unauthorized", 401);
          return yield* handler;
        }).pipe(
          Effect.catchTags({
            HttpError: (e) => Effect.succeed(errorJson(e.code, e.status, e.message)),
            NoteNotFound: () => Effect.succeed(errorJson("noteNotFound", 404)),
            NoteExists: () => Effect.succeed(errorJson("noteExists", 409)),
            NoteChanged: () => Effect.succeed(errorJson("noteChanged", 412)),
            RevisionNotFound: () => Effect.succeed(errorJson("revisionNotFound", 404)),
            ViewNotFound: () => Effect.succeed(errorJson("viewNotFound", 404)),
            ViewExists: () => Effect.succeed(errorJson("viewExists", 409)),
          }),
          Effect.catchDefect((defect) =>
            Effect.as(Effect.logError("unhandled", defect), errorJson("internal", 500)),
          ),
        );

      // One route per path: each method's handler, and 405 + Allow for every other method.
      const resource = (
        path: HttpRouter.PathInput,
        handlers: Partial<Record<Method, Handler>>,
        options?: { auth?: boolean },
      ) => {
        const allow = Object.keys(handlers).join(", ");
        return HttpRouter.route("*", path, (req) => {
          const handler = handlers[req.method as Method];
          return handler
            ? guard(handler, options)
            : Effect.succeed(errorJson("methodNotAllowed", 405, undefined, { allow }));
        });
      };

      /**
       * Two revisions of a note: `to` (default the latest) against `from` (default the one before
       * `to`), or against the note as it was at `since`, to see what changed after a given time.
       */
      const diff = Effect.fnUntraced(function* (noteId: string, p: URLSearchParams) {
        yield* store.get(noteId);
        const fromId = yield* positiveInt(p, "from");
        const toId = yield* positiveInt(p, "to");
        const sinceParam = p.get("since");
        if (sinceParam !== null && fromId !== undefined)
          return yield* refuse("invalidParam", 400, "Pass either from or since, not both");
        const sinceTime = sinceParam === null ? undefined : Date.parse(sinceParam);
        if (sinceTime !== undefined && Number.isNaN(sinceTime))
          return yield* refuse("invalidParam", 400, "since must be an ISO date-time");

        const to =
          toId === undefined
            ? yield* Effect.flatMap(store.latestRevision(noteId), (latest) =>
                Option.match(latest, {
                  onNone: () => Effect.fail(refuse("revisionNotFound", 404)),
                  onSome: Effect.succeed,
                }),
              )
            : yield* store.revision(noteId, toId);
        const from =
          fromId !== undefined
            ? yield* store.revision(noteId, fromId)
            : Option.getOrNull(
                yield* sinceTime !== undefined
                  ? store.latestRevision(noteId, new Date(sinceTime).toISOString())
                  : store.previousRevision(noteId, to.id),
              );
        return {
          note_id: noteId,
          from: from && withoutBody(from),
          to: withoutBody(to),
          changes: fieldChanges(from, to),
          diff: unifiedDiff(from?.body ?? "", to.body, [revisionLabel(from), revisionLabel(to)]),
        } satisfies NoteDiff;
      });

      const request = HttpServerRequest.HttpServerRequest;

      // Annotated: inferred from a mixed list, the requirements would widen to any.
      const all: ReadonlyArray<HttpRouter.Route<never, HttpPlatform.HttpPlatform>> = [
        resource("/api/health", { GET: Effect.succeed(json({ ok: true })) }, { auth: false }),

        resource("/api/notes", {
          GET: Effect.gen(function* () {
            const req = yield* request;
            return json(yield* store.list(yield* readListQuery(searchParams(req))));
          }),
          POST: Effect.gen(function* () {
            const req = yield* request;
            const input = yield* readInput(req);
            if (!input.body?.trim() && !input.title?.trim()) return yield* refuse("emptyNote", 400);
            return noteJson(yield* store.create(input, authorOf(req)), 201);
          }),
        }),

        resource("/api/notes/:id", {
          GET: Effect.map(Effect.flatMap(routeId, store.get), (note) => noteJson(note)),
          PATCH: Effect.gen(function* () {
            const req = yield* request;
            const { id: _, ...patch } = yield* readInput(req);
            const ifMatch = req.headers["if-match"];
            const note = yield* store.update(yield* routeId, patch, authorOf(req), (current) =>
              matches(ifMatch, current),
            );
            return noteJson(note);
          }),
          DELETE: Effect.as(Effect.flatMap(routeId, store.delete), noContent),
        }),

        resource("/api/notes/:id/append", {
          POST: Effect.gen(function* () {
            const req = yield* request;
            const text = yield* readAppendText(req);
            if (!text) return yield* refuse("emptyAppend", 400);
            return noteJson(yield* store.append(yield* routeId, text, authorOf(req)));
          }),
        }),

        resource("/api/notes/:id/revisions", {
          GET: Effect.gen(function* () {
            const id = yield* routeId;
            yield* store.get(id);
            return json(yield* store.revisions(id, page(searchParams(yield* request))));
          }),
        }),

        resource("/api/notes/:id/revisions/:rev", {
          GET: Effect.gen(function* () {
            const id = yield* routeId;
            const rev = Number((yield* HttpRouter.params).rev);
            yield* store.get(id);
            if (!Number.isInteger(rev)) return yield* new RevisionNotFound({ id: rev });
            return json(yield* store.revision(id, rev));
          }),
        }),

        resource("/api/notes/:id/diff", {
          GET: Effect.gen(function* () {
            return json(yield* diff(yield* routeId, searchParams(yield* request)));
          }),
        }),

        resource("/api/tags", { GET: Effect.map(store.tags, (tags) => json(tags)) }),

        resource("/api/views", {
          GET: Effect.map(store.views, (views) => json(views)),
          POST: Effect.gen(function* () {
            const body = yield* readJson(yield* request);
            const { name, query } = (body && typeof body === "object" ? body : {}) as Record<
              string,
              unknown
            >;
            if (
              typeof name !== "string" ||
              !name.trim() ||
              typeof query !== "string" ||
              !query.trim()
            )
              return yield* refuse("invalidBody", 400, "name and query must be non-empty strings");
            return json(yield* store.createView(name.trim().slice(0, 64), query.trim()), 201);
          }),
        }),

        resource("/api/views/:id", {
          DELETE: Effect.as(Effect.flatMap(routeId, store.deleteView), noContent),
        }),

        HttpRouter.route("GET", "/openapi.json", json(openapi)),
        HttpRouter.route("GET", "/llms.txt", (req) =>
          Effect.succeed(
            HttpServerResponse.text(llmsTxt(new URL(req.originalUrl).origin), {
              contentType: "text/plain; charset=utf-8",
            }),
          ),
        ),

        // PWA files that must live at the root. The app itself is bundled from the HTML import.
        HttpRouter.route(
          "GET",
          "/sw.js",
          staticFile("sw.js", undefined, { "cache-control": "no-cache" }),
        ),
        HttpRouter.route(
          "GET",
          "/manifest.webmanifest",
          staticFile("manifest.webmanifest", "application/manifest+json"),
        ),
        HttpRouter.route("GET", "/icon.svg", staticFile("icon.svg")),

        // Everything else, under /api or not.
        HttpRouter.route("*", "*", errorJson("notFound", 404)),
      ];
      return all;
    }),
  );

type ServerOptions = {
  token?: Redacted.Redacted;
  hostname?: string;
  port?: number;
  development?: boolean;
};

/** The API and PWA served by Bun, on whatever Store is provided. Port 0 picks a free one. */
export const serverLayer = ({
  token,
  hostname = "127.0.0.1",
  port = 0,
  development = false,
}: ServerOptions) =>
  HttpRouter.serve(routes(token), { disableLogger: true, disableListenLog: true }).pipe(
    Layer.provideMerge(
      BunHttpServer.layer({
        hostname,
        port,
        // Served by Bun itself, ahead of the Effect router: Bun bundles the HTML import on the
        // fly in development (with HMR, and browser console logs streamed to the terminal); in
        // production it bundles once at startup.
        routes: { "/": homepage },
        development: development && { hmr: true, console: true },
      }),
    ),
  );

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

class UnsafeListen extends Data.TaggedError("UnsafeListen")<{ host: string }> {
  override get message() {
    return `Refusing to listen on ${this.host} without PAD_TOKEN. Set PAD_TOKEN to a long random secret.`;
  }
}

/** `pad serve` and `bun src/server.ts`: the server on the configured address and database. */
export const main = Effect.gen(function* () {
  const config = yield* ServerConfig;
  if (!LOOPBACK.has(config.host) && Option.isNone(config.token))
    return yield* new UnsafeListen({ host: config.host });
  const token = Option.getOrUndefined(config.token);
  const live = serverLayer({
    token,
    hostname: config.host,
    port: config.port,
    development: !config.production,
  }).pipe(Layer.provide(Store.layer(config.db)));
  return yield* Layer.launch(
    Layer.effectDiscard(
      HttpServer.addressFormattedWith((url) =>
        Effect.log(
          `scratchpad listening on ${url} (db: ${config.db}${token ? ", token auth on" : ""})`,
        ),
      ),
    ).pipe(Layer.provideMerge(live)),
  );
});

export const start = () => BunRuntime.runMain(main);

if (import.meta.main) start();
