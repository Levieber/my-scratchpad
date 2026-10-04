// The API's endpoints: one `resource` per path, each handler an Effect on the Store.
import * as Effect from "effect/Effect";
import type * as HttpPlatform from "effect/http/HttpPlatform";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import type * as Redacted from "effect/Redacted";

import { RevisionNotFound } from "@/server/storage/errors";
import { Store } from "@/server/storage/store";
import { DEFAULT_MAX_IMPORT_BYTES } from "@/shared/archive";

import { llmsTxt } from "./docs/llms";
import { openapi } from "./docs/openapi";
import { hookNotes, hooksInfo, readScope, readSelection, routeHook } from "./hook-notes";
import {
  authorOf,
  errorJson,
  json,
  matches,
  noContent,
  noteJson,
  page,
  polled,
  readAppendText,
  readInput,
  readListQuery,
  refuse,
  routeId,
  searchParams,
} from "./http";
import { noteDiff } from "./note-diff";
import { pwaRoutes } from "./pwa";
import { resourceWith } from "./resource";
import { exportArchive, importArchive, importLimits } from "./transfer";
import { readView } from "./views";

/**
 * The API's routes, on the Store. With `token`, every route but the health check needs it;
 * `maxImportBytes` is the most one import may send.
 */
export const routes = (
  token: Redacted.Redacted | undefined,
  maxImportBytes = DEFAULT_MAX_IMPORT_BYTES,
) =>
  HttpRouter.addAll(
    Effect.gen(function* () {
      const store = yield* Store;

      const resource = resourceWith(token);

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
          GET: polled(
            store.version,
            Effect.gen(function* () {
              const req = yield* request;
              return yield* store.list(yield* readListQuery(searchParams(req)));
            }),
          ),
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
            return json(yield* noteDiff(store, yield* routeId, searchParams(yield* request)));
          }),
        }),

        resource("/api/tags", { GET: polled(store.version, store.tags) }),

        resource("/api/views", {
          GET: polled(store.version, store.views),
          POST: Effect.gen(function* () {
            const view = yield* readView(yield* request, { create: true });
            return json(yield* store.createView(view), 201);
          }),
        }),

        resource("/api/views/:id", {
          PATCH: Effect.gen(function* () {
            const patch = yield* readView(yield* request, { create: false });
            return json(yield* store.updateView(yield* routeId, patch));
          }),
          DELETE: Effect.as(Effect.flatMap(routeId, store.deleteView), noContent),
        }),

        resource("/api/pins", { GET: polled(store.version, store.pins) }),

        // PUT and DELETE on the note's id: both idempotent, so a client can retry either blindly.
        resource("/api/pins/:id", {
          PUT: Effect.as(Effect.flatMap(routeId, store.pin), noContent),
          DELETE: Effect.as(Effect.flatMap(routeId, store.unpin), noContent),
        }),

        // A download, so it carries a filename; the notes are all of them, not a page.
        resource("/api/export", {
          GET: Effect.flatMap(request, (req) => exportArchive(store, req)),
        }),

        // GET says what a client may send, and that this server imports at all.
        resource("/api/import", {
          GET: Effect.succeed(importLimits(maxImportBytes)),
          POST: Effect.flatMap(request, (req) => importArchive(store, req, maxImportBytes)),
        }),

        resource("/api/hooks", { GET: Effect.map(hooksInfo(store), (info) => json(info)) }),

        resource("/api/hooks/:name", {
          PUT: Effect.gen(function* () {
            const req = yield* request;
            const hook = yield* routeHook;
            const { scope, patch } = yield* readSelection(req);
            return json(yield* store.saveHookSelection(hook, scope, patch, authorOf(req)));
          }),
          DELETE: Effect.gen(function* () {
            const hook = yield* routeHook;
            const scope = yield* readScope(searchParams(yield* request).get("scope"));
            return yield* Effect.as(store.deleteHookSelection(hook, scope), noContent);
          }),
        }),

        resource("/api/hooks/:name/notes", {
          GET: Effect.gen(function* () {
            const hook = yield* routeHook;
            return json(yield* hookNotes(store, hook, searchParams(yield* request)));
          }),
        }),

        // Like pins: PUT and DELETE are idempotent, so a client can retry either blindly.
        resource("/api/hooks/:name/include/:id", {
          PUT: Effect.gen(function* () {
            const req = yield* request;
            const hook = yield* routeHook;
            const scope = yield* readScope(searchParams(req).get("scope"));
            yield* store.pickHookNote(hook, scope, yield* routeId, authorOf(req));
            return noContent;
          }),
          DELETE: Effect.gen(function* () {
            const req = yield* request;
            const hook = yield* routeHook;
            const scope = yield* readScope(searchParams(req).get("scope"));
            yield* store.unpickHookNote(hook, scope, yield* routeId, authorOf(req));
            return noContent;
          }),
        }),

        HttpRouter.route("GET", "/openapi.json", json(openapi)),
        HttpRouter.route("GET", "/llms.txt", (req) =>
          Effect.succeed(
            HttpServerResponse.text(llmsTxt(new URL(req.originalUrl).origin), {
              contentType: "text/plain; charset=utf-8",
            }),
          ),
        ),

        ...pwaRoutes,

        // Everything else, under /api or not.
        HttpRouter.route("*", "*", errorJson("notFound", 404)),
      ];
      return all;
    }),
  );
