// Client-side settings written by `pad login`, so the CLI, MCP server and hooks can point at a
// local or a deployed (Railway) server without juggling env vars.
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import { configFile, optional, port, readJsonFile } from "./env";

const readClientFile = (path: string) =>
  Effect.map(readJsonFile(path), (file): { url?: string; token?: string } => ({
    url: typeof file.url === "string" ? file.url : undefined,
    token: typeof file.token === "string" ? file.token : undefined,
  }));

/** Where the API lives and the token to send. Env wins over `pad login`. */
export class ClientConfig extends Context.Service<
  ClientConfig,
  {
    /** The file `pad login` writes. */
    readonly path: string;
    readonly url: string;
    readonly token: Option.Option<Redacted.Redacted>;
  }
>()("pad/ClientConfig") {
  static readonly layer = Layer.effect(
    ClientConfig,
    Effect.gen(function* () {
      const path = yield* configFile("config.json");
      const file = yield* readClientFile(path);
      const env = yield* Config.all({
        url: optional("PAD_URL"),
        token: optional("PAD_TOKEN"),
        port,
      });
      const url = Option.getOrElse(env.url, () => file.url ?? `http://127.0.0.1:${env.port}`);
      const token = Option.orElse(env.token, () => Option.fromNullishOr(file.token || undefined));
      return { path, url: url.replace(/\/$/, ""), token: Option.map(token, Redacted.make) };
    }),
  );
}
