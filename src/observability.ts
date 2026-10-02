// What the server tells whoever runs it: a request id on every request and response, one log line
// per request carrying it, and JSON logs in production so the platform can index them.
import * as Effect from "effect/Effect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";

export const REQUEST_ID_HEADER = "x-request-id";

// The platform's id first, so a line in its access log leads to ours (and to any error logged while
// handling the request); `x-request-id` lets a caller pick one; a request with neither gets its own.
const INCOMING_ID_HEADERS = ["x-railway-request-id", REQUEST_ID_HEADER, "cf-ray"];

// An id comes from outside and is echoed in a header and written to the log: accept only a short
// run of plain characters, and make up our own for anything else rather than cut it down.
const clean = (id: string | undefined) => (id && /^[\w.:/=+-]{1,128}$/.test(id) ? id : undefined);

export const requestIdOf = (headers: Record<string, string | undefined>) =>
  INCOMING_ID_HEADERS.map((name) => clean(headers[name])).find(Boolean) ?? crypto.randomUUID();

const pathOf = (url: string) => {
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    return "?";
  }
};

/**
 * Wraps every route (the fallbacks too). Logs written while handling the request carry its id; one
 * line per request says what was asked and how it went. Only the path is logged: a query string
 * holds what the user searched for, and the Authorization header never leaves the request.
 */
export const requestLogging = HttpRouter.middleware(
  (handler) =>
    Effect.gen(function* () {
      const req = yield* HttpServerRequest.HttpServerRequest;
      const requestId = requestIdOf(req.headers);
      const started = performance.now();
      const response = yield* Effect.annotateLogs(handler, { requestId });
      const { status } = response;
      const path = pathOf(req.originalUrl);
      // A health check runs every few seconds on some platforms: it would drown the rest.
      if (path !== "/api/health" || status >= 400)
        yield* Effect.annotateLogs(
          status >= 500 ? Effect.logError("request") : Effect.logInfo("request"),
          {
            requestId,
            method: req.method,
            path,
            status,
            durationMs: Math.round(performance.now() - started),
          },
        );
      return HttpServerResponse.setHeader(response, REQUEST_ID_HEADER, requestId);
    }),
  { global: true },
);

/** JSON lines on stdout in production; the readable default everywhere else. */
export const logsLayer = (production: boolean): Layer.Layer<never> =>
  production ? Logger.layer([Logger.consoleJson]) : Layer.empty;
