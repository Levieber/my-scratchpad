// The API's endpoints: one `resource` per path, each handler an Effect on the Store.
import * as Effect from "effect/Effect";
import type * as HttpPlatform from "effect/http/HttpPlatform";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import type * as Redacted from "effect/Redacted";

import { RevisionNotFound } from "@/server/storage/errors";
import { Store } from "@/server/storage/store";

import { llmsTxt } from "./docs/llms";
import { openapi } from "./docs/openapi";
import {
  authorOf,
  errorJson,
  json,
  matches,
  noContent,
  noteJson,
  page,
  readAppendText,
  readInput,
  readJson,
  readListQuery,
  refuse,
  routeId,
  searchParams,
} from "./http";
import { noteDiff } from "./note-diff";
import { pwaRoutes } from "./pwa";
import { resourceWith } from "./resource";

/** The API's routes, on the Store. With `token`, every route but the health check needs it. */
export const routes = (token: Redacted.Redacted | undefined) =>
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
            return json(yield* noteDiff(store, yield* routeId, searchParams(yield* request)));
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

        resource("/api/pins", { GET: Effect.map(store.pins, (notes) => json(notes)) }),

        // PUT and DELETE on the note's id: both idempotent, so a client can retry either blindly.
        resource("/api/pins/:id", {
          PUT: Effect.as(Effect.flatMap(routeId, store.pin), noContent),
          DELETE: Effect.as(Effect.flatMap(routeId, store.unpin), noContent),
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
