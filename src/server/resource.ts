// How a path becomes a route: one handler per method, the bearer check, and the translation of
// every refusal and store failure into an error response.
import * as Effect from "effect/Effect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import type * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Redacted from "effect/Redacted";

import { errorJson, type Failure, refuse } from "./http";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

type Method = (typeof METHODS)[number];

/** A route's handler: it reads the request and its route params, nothing else per request. */
export type Handler = Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  Failure,
  HttpServerRequest.HttpServerRequest | HttpRouter.RouteContext
>;

/**
 * `resource` for a server: with `token`, every resource but those opened with `auth: false` needs
 * it as a bearer token.
 */
export const resourceWith = (token: Redacted.Redacted | undefined) => {
  const authorized = (req: HttpServerRequest.HttpServerRequest) =>
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
        InvalidViewOptions: (e) =>
          Effect.succeed(errorJson("invalidViewOptions", 400, `options: ${e.reason}`)),
        PinLimit: () => Effect.succeed(errorJson("pinLimit", 409)),
        HookLimit: (e) => Effect.succeed(errorJson("hookLimit", 409, e.reason)),
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
  return (
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
};
