import * as BunHttpServer from "@effect/platform-bun/BunHttpServer";
import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServer from "effect/http/HttpServer";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";
import type * as Runtime from "effect/Runtime";

import { ServerConfig } from "@/config/server";
import { Store } from "@/server/storage/store";

import { logsLayer, requestLogging } from "./observability";
import { pageRoutes } from "./pages";
import { buildPwa } from "./pwa-build";
import { routes } from "./routes";

type ServerOptions = {
  token?: Redacted.Redacted;
  hostname?: string;
  port?: number;
  development?: boolean;
  /** The folder of a built PWA to serve (pwa-build.ts); without it, Bun bundles it on demand. */
  prebuilt?: string;
};

/** The API and PWA served by Bun, on whatever Store is provided. Port 0 picks a free one. */
export const serverLayer = ({
  token,
  hostname = "127.0.0.1",
  port = 0,
  development = false,
  prebuilt,
}: ServerOptions) =>
  HttpRouter.serve(Layer.merge(routes(token), requestLogging), {
    disableLogger: true,
    disableListenLog: true,
  }).pipe(
    Layer.provideMerge(
      BunHttpServer.layer({
        hostname,
        port,
        // Served by Bun itself, ahead of the Effect router: Bun bundles the HTML import on the
        // fly in development (with HMR, and browser console logs streamed to the terminal), and
        // on the first request otherwise, unless the app was built ahead of time. Every page's
        // address serves it, so a reload or a bookmark opens that page, under the CSP (pages.ts).
        routes: pageRoutes(development, prebuilt),
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

/**
 * The exit code of `bun src/server.ts`. A signal (SIGTERM from a redeploy, SIGINT) interrupts the
 * main fiber and `main` never succeeds on its own, so an interrupt-only exit is the requested
 * shutdown and exits 0: a non-zero code is what Railway's and systemd's on-failure restart policies
 * report as a crash.
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

/** `pad serve` and `bun src/server.ts`: the server on the configured address and database. */
export const main = Effect.gen(function* () {
  const config = yield* ServerConfig;
  if (!LOOPBACK.has(config.host) && Option.isNone(config.token))
    return yield* new UnsafeListen({ host: config.host });
  const token = Option.getOrUndefined(config.token);
  // In production only: development keeps Bun's dev server and its HMR.
  const prebuilt = config.production ? yield* buildPwa : undefined;
  if (config.production)
    yield* prebuilt
      ? Effect.log("PWA built ahead of time")
      : Effect.logWarning("PWA not prebuilt: Bun will bundle it on the first request");
  const live = serverLayer({
    token,
    hostname: config.host,
    port: config.port,
    development: !config.production,
    prebuilt,
  }).pipe(Layer.provide(Store.layer(config.db)));
  return yield* Layer.launch(
    Layer.effectDiscard(
      HttpServer.addressFormattedWith((url) =>
        Effect.log(
          `scratchpad listening on ${url} (db: ${config.db}${token ? ", token auth on" : ""})`,
        ),
      ),
    ).pipe(Layer.provideMerge(live), Layer.provide(logsLayer(config.production))),
  );
});
