// What the server listens on and stores into. Tokens are Redacted, so logging a config never
// prints them.
import { join } from "node:path";

import * as Config from "effect/Config";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import { optional, platformPort, port, xdg } from "./env";

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
