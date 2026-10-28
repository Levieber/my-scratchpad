// What the server listens on and stores into. Tokens are Redacted, so logging a config never
// prints them.
import { join } from "node:path";

import * as Config from "effect/Config";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import { DEFAULT_MAX_IMPORT_BYTES } from "@/shared/archive";

import { bindHost, optional, port, xdg } from "./env";

export const ServerConfig = Config.all({
  host: bindHost,
  port,
  db: Config.all([optional("PAD_DB"), xdg("XDG_DATA_HOME", ".local/share")]).pipe(
    Config.map(([db, data]) => Option.getOrElse(db, () => join(data, "scratchpad", "pad.db"))),
  ),
  // Optional shared secret; required when listening on a non-loopback address.
  token: Config.map(optional("PAD_TOKEN"), Option.map(Redacted.make)),
  // The most one import (POST /api/import) may send; clients read it from GET /api/import.
  maxImportBytes: Config.Int("PAD_MAX_IMPORT_BYTES").pipe(
    Config.withDefault(DEFAULT_MAX_IMPORT_BYTES),
  ),
  production: Config.map(optional("NODE_ENV"), (env) => Option.getOrNull(env) === "production"),
});
