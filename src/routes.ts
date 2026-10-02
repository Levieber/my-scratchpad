// The API's endpoints: one `resource` per path, each handler an Effect on the Store.
import icon from "@public/icon.svg" with { type: "file" };
import manifest from "@public/manifest.webmanifest" with { type: "file" };
import serviceWorker from "@public/sw.js" with { type: "file" };
import * as Effect from "effect/Effect";
import type * as HttpPlatform from "effect/http/HttpPlatform";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import { RevisionNotFound, Store } from "./db";
import { unifiedDiff } from "./diff";
import { type FullRevision, type NoteDiff, withoutBody } from "./domain";
import {
  authorOf,
  errorJson,
  type Failure,
  json,
  matches,
  noContent,
  noteJson,
  page,
  positiveInt,
  readAppendText,
  readInput,
  readJson,
  readListQuery,
  refuse,
  routeId,
  searchParams,
  staticFile,
} from "./http";
import { llmsTxt, openapi } from "./openapi";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

type Method = (typeof METHODS)[number];
type Request = HttpServerRequest.HttpServerRequest;

/** A route's handler: it reads the request and its route params, nothing else per request. */
type Handler = Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  Failure,
  HttpServerRequest.HttpServerRequest | HttpRouter.RouteContext
>;

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
            // The driver's error is the diagnosis (a locked, missing or corrupt file), so it is logged.
            DatabaseUnavailable: (e) =>
              Effect.as(
                Effect.logError("database unavailable", e.cause),
                errorJson("unavailable", 503),
              ),
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
        // Open to anyone, since a platform's checker has no token; it only says whether the
        // database answers, and never why (that goes to the log).
        resource(
          "/api/health",
          { GET: Effect.as(store.ping, json({ ok: true })) },
          { auth: false },
        ),

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
          staticFile(serviceWorker, undefined, { "cache-control": "no-cache" }),
        ),
        HttpRouter.route(
          "GET",
          "/manifest.webmanifest",
          staticFile(manifest, "application/manifest+json"),
        ),
        HttpRouter.route("GET", "/icon.svg", staticFile(icon, "image/svg+xml")),

        // Everything else, under /api or not.
        HttpRouter.route("*", "*", errorJson("notFound", 404)),
      ];
      return all;
    }),
  );
