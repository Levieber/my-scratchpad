import * as BunHttpServer from "@effect/platform-bun/BunHttpServer";
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServer from "effect/http/HttpServer";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";

import { ServerConfig } from "./config";
import { Store } from "./db";
import { logsLayer, requestLogging } from "./observability";
import { routes } from "./routes";
import homepage from "./web/index.html";

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
  HttpRouter.serve(Layer.merge(routes(token), requestLogging), {
    disableLogger: true,
    disableListenLog: true,
  }).pipe(
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
    ).pipe(Layer.provideMerge(live), Layer.provide(logsLayer(config.production))),
  );
});

export const start = () => BunRuntime.runMain(main);

if (import.meta.main) start();
