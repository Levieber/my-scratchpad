// The MCP server over Streamable HTTP, for claude.ai's connectors (web, desktop and mobile), which
// can't start a process the way Claude Code does. It is a client like the stdio server: its tools
// call the API with PAD_TOKEN, and it signs in whoever connects with OAuth (oauth/).
import * as BunHttpServer from "@effect/platform-bun/BunHttpServer";
import * as McpServer from "effect/ai/McpServer";
import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServer from "effect/http/HttpServer";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import type * as Runtime from "effect/Runtime";

import { Client } from "@/client/client";
import { ClientConfig } from "@/config/client";
import { McpHttpConfig } from "@/config/mcp-http";
import { ERROR_MESSAGES } from "@/shared/errors";

import { NoteHandlers } from "./handlers";
import { MCP_PATH, makeOAuth } from "./oauth/routes";
import { serverOptions } from "./server";
import { Notes } from "./tools";

// A browser sending an Origin is refused unless it is one of these (DNS rebinding); claude.ai
// calls from its servers, which may name it.
const ALLOWED_ORIGINS = ["https://claude.ai", "https://claude.com"];

const pathOf = (url: string) => {
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    return "?";
  }
};

// One line per request, as the API logs them: the path only, since the query of /authorize holds
// the client's state, and never the Authorization header.
const requestLogging = HttpRouter.middleware(
  (handler) =>
    Effect.gen(function* () {
      const req = yield* HttpServerRequest.HttpServerRequest;
      const started = performance.now();
      const response = yield* handler;
      const path = pathOf(req.originalUrl);
      if (path !== "/health" || response.status >= 400)
        yield* Effect.annotateLogs(
          response.status >= 500 ? Effect.logError("request") : Effect.logInfo("request"),
          {
            method: req.method,
            path,
            status: response.status,
            durationMs: Math.round(performance.now() - started),
          },
        );
      return response;
    }),
  { global: true },
);

export type McpHttpOptions = {
  /** The API the tools call, and the token they call it with (PAD_TOKEN). */
  api: { url: string; token: Redacted.Redacted };
  /** The origin claude.ai reaches this server at. */
  publicUrl: string;
  /** Signs the connectors' tokens; PAD_TOKEN when unset. */
  oauthSecret?: Redacted.Redacted;
  author: string;
  hostname?: string;
  /** 0 picks a free one. */
  port?: number;
};

/** The MCP endpoint, its authorization server and a health check, on Bun. */
export const mcpHttpLayer = ({
  api,
  publicUrl,
  oauthSecret,
  author,
  hostname = "127.0.0.1",
  port = 0,
}: McpHttpOptions) => {
  const oauth = makeOAuth({
    publicUrl,
    ownerToken: Redacted.value(api.token),
    secret: Redacted.value(oauthSecret ?? api.token),
  });
  const mcp = McpServer.toolkit(Notes).pipe(
    Layer.provide(NoteHandlers),
    Layer.provide(Client.layerWith({ url: api.url, author, token: Option.some(api.token) })),
    Layer.provide(
      McpServer.layerHttp({
        ...serverOptions({ url: api.url, author }),
        path: MCP_PATH,
        allowedOrigins: ALLOWED_ORIGINS,
      }).pipe(Layer.provide(oauth.requireToken)),
    ),
  );
  const pages: ReadonlyArray<HttpRouter.Route<never, never>> = [
    // Open, so the platform can tell the process is up; it says nothing about the API.
    HttpRouter.route("GET", "/health", HttpServerResponse.jsonUnsafe({ ok: true })),
    HttpRouter.route(
      "GET",
      "/",
      HttpServerResponse.text(
        `Scratchpad's MCP server. Add ${publicUrl}${MCP_PATH} as a custom connector in Claude (Settings → Connectors).\n`,
      ),
    ),
    HttpRouter.route(
      "*",
      "*",
      HttpServerResponse.jsonUnsafe(
        { error: "notFound", message: ERROR_MESSAGES.notFound },
        { status: 404 },
      ),
    ),
  ];
  const app = Layer.mergeAll(mcp, oauth.routes, HttpRouter.addAll(pages), requestLogging);
  return HttpRouter.serve(app, {
    disableLogger: true,
    disableListenLog: true,
  }).pipe(Layer.provideMerge(BunHttpServer.layer({ hostname, port })));
};

class MissingToken extends Data.TaggedError("MissingToken") {
  override get message() {
    return "MCP over HTTP needs PAD_TOKEN: its tools call the API with it, and it is what you approve a connector with.";
  }
}

/** `bun src/mcp-http.ts`: the server on the configured address, in front of the configured API. */
export const main = Effect.gen(function* () {
  const config = yield* McpHttpConfig;
  const client = yield* ClientConfig;
  if (Option.isNone(client.token)) return yield* new MissingToken();
  if (!config.publicUrl.startsWith("https://") && config.production)
    yield* Effect.logWarning(
      `${config.publicUrl} is not https: claude.ai only connects to https servers. Set PAD_MCP_URL.`,
    );
  const live = mcpHttpLayer({
    api: { url: client.url, token: client.token.value },
    publicUrl: config.publicUrl,
    oauthSecret: Option.getOrUndefined(config.oauthSecret),
    author: config.author,
    hostname: config.host,
    port: config.port,
  });
  return yield* Layer.launch(
    Layer.effectDiscard(
      HttpServer.addressFormattedWith((address) =>
        Effect.log(
          `scratchpad MCP listening on ${address}: connect ${config.publicUrl}${MCP_PATH} (API: ${client.url})`,
        ),
      ),
    ).pipe(
      Layer.provideMerge(live),
      // JSON lines in production, as the API writes them, so the platform can index them.
      Layer.provide(config.production ? Logger.layer([Logger.consoleJson]) : Layer.empty),
    ),
  );
});

/**
 * A signal (SIGTERM from a redeploy) is the requested shutdown and exits 0, as the API's
 * `teardown` (server/serve.ts) does: a non-zero code is what an on-failure restart policy reports
 * as a crash. Clients don't import the server, hence this copy.
 */
export const teardown: Runtime.Teardown = (exit, onExit) => {
  if (Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause)) {
    console.log("Program finished successfully.");
    onExit(0);
  } else {
    console.error("Program ended with an error.");
    onExit(1);
  }
};
