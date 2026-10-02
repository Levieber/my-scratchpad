// What the three configs (server, client, hooks) read the same way: environment variables, the XDG
// folders and the JSON files under ~/.config/scratchpad. Every config is Effect `Config`, so a value
// that is set but malformed (PAD_PORT=abc) fails at startup instead of becoming NaN.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

// Empty counts as unset: `PAD_TOKEN= pad ls` is how a shell clears one for a command.
export const optional = (name: string) =>
  Config.option(Config.String(name)).pipe(Config.map(Option.filter((v) => v !== "")));

export const xdg = (name: string, fallback: string) =>
  Config.String(name).pipe(Config.withDefault(join(homedir(), fallback)));

// Railway (and most PaaS) inject PORT and expect the app on 0.0.0.0.
export const platformPort = Config.option(Config.Port("PORT"));

export const port = Config.all([Config.option(Config.Port("PAD_PORT")), platformPort]).pipe(
  Config.map(([own, platform]) =>
    Option.getOrElse(
      Option.orElse(own, () => platform),
      () => 7777,
    ),
  ),
);

/** A file in `~/.config/scratchpad` (or under `XDG_CONFIG_HOME`). */
export const configFile = (name: string) =>
  Config.map(xdg("XDG_CONFIG_HOME", ".config"), (dir) => join(dir, "scratchpad", name));

/** The JSON object in `path`; `{}` when the file is missing, broken or not an object. */
export const readJsonFile = (path: string) =>
  Effect.sync((): Record<string, unknown> => {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  });
