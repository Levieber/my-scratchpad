// Every env var and ~/.config/scratchpad/config.json, read in one place, as Effect Config: a value
// that is set but malformed (PAD_PORT=abc) fails at startup instead of becoming NaN, and tokens are
// Redacted, so logging a config never prints them.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

// Empty counts as unset: `PAD_TOKEN= pad ls` is how a shell clears one for a command.
const optional = (name: string) =>
  Config.option(Config.String(name)).pipe(Config.map(Option.filter((v) => v !== "")));

const xdg = (name: string, fallback: string) =>
  Config.String(name).pipe(Config.withDefault(join(homedir(), fallback)));

// Railway (and most PaaS) inject PORT and expect the app on 0.0.0.0.
const platformPort = Config.option(Config.Port("PORT"));

const port = Config.all([Config.option(Config.Port("PAD_PORT")), platformPort]).pipe(
  Config.map(([own, platform]) =>
    Option.getOrElse(
      Option.orElse(own, () => platform),
      () => 7777,
    ),
  ),
);

/** What the server listens on and stores into. */
export const ServerConfig = Config.all({
  host: Config.all([optional("PAD_HOST"), platformPort]).pipe(
    Config.map(([host, platform]) =>
      Option.getOrElse(host, () => (Option.isSome(platform) ? "0.0.0.0" : "127.0.0.1")),
    ),
  ),
  port,
  db: Config.all([optional("PAD_DB"), xdg("XDG_DATA_HOME", ".local/share")]).pipe(
    Config.map(([db, data]) => Option.getOrElse(db, () => join(data, "scratchpad", "pad.db"))),
  ),
  // Optional shared secret; required when listening on a non-loopback address.
  token: Config.map(optional("PAD_TOKEN"), Option.map(Redacted.make)),
  production: Config.map(optional("NODE_ENV"), (env) => Option.getOrNull(env) === "production"),
});

// Client-side settings written by `pad login`, so the CLI, MCP server and hooks
// can point at a local or a deployed (Railway) server without juggling env vars.
const clientConfigPath = Config.map(xdg("XDG_CONFIG_HOME", ".config"), (dir) =>
  join(dir, "scratchpad", "config.json"),
);

const readClientFile = (path: string) =>
  Effect.sync((): { url?: string; token?: string } => {
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch {
      return {};
    }
  });

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
      const path = yield* clientConfigPath;
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
