// Which server `pad` talks to, and running one.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import * as Argument from "effect/cli/Argument";
import * as Command from "effect/cli/Command";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import { Author, out, reported, usage } from "@/cli/root";
import { ApiError, Client } from "@/client/client";
import { ClientConfig } from "@/config/client";

export const status = Command.make(
  "status",
  {},
  Effect.fn(function* () {
    const config = yield* ClientConfig;
    const who = yield* Author;
    const ok = yield* (yield* Client)
      .health()
      .pipe(Effect.match({ onSuccess: () => true, onFailure: () => false }));
    const token = Option.isSome(config.token);
    const info = { url: config.url, reachable: ok, token, author: who, config: config.path };
    yield* out(
      info,
      () =>
        `${config.url}  ${ok ? "reachable" : "UNREACHABLE"}${token ? " (token set)" : ""}  as ${who}`,
    );
  }, reported),
).pipe(Command.withDescription("Show which server is in use"));

export const login = Command.make(
  "login",
  { url: Argument.String("url"), token: Argument.String("token").pipe(Argument.optional) },
  Effect.fn(function* (a) {
    const url = a.url.replace(/\/$/, "");
    const token = Option.filter(
      Option.orElse(a.token, () =>
        Option.fromNullishOr(process.stdin.isTTY ? prompt("Token (blank for none):") : undefined),
      ),
      (t) => t !== "",
    );
    // Checked through the API itself: a notes request is the first thing that needs the token.
    yield* Effect.flatMap(Effect.service(Client), (c) => c.list({ limit: 1 })).pipe(
      Effect.provide(
        Client.layerWith({ url, author: "human", token: Option.map(token, Redacted.make) }),
      ),
      Effect.mapError((e) =>
        e.status === 0
          ? new ApiError({ status: 0, message: `Cannot reach ${url}` })
          : e.status === 401
            ? new ApiError({ status: 401, message: "Server rejected the token." })
            : e,
      ),
    );
    const { path } = yield* ClientConfig;
    yield* Effect.sync(() => {
      mkdirSync(dirname(path), { recursive: true });
      const saved = { url, token: Option.getOrUndefined(token) };
      writeFileSync(path, JSON.stringify(saved, null, 2) + "\n", { mode: 0o600 });
    });
    yield* out({ url, saved: path }, () => `Now using ${url} (saved to ${path})`);
  }, reported),
).pipe(Command.withDescription("Point CLI/MCP at a server (e.g. Railway)"));

export const logout = Command.make(
  "logout",
  {},
  Effect.fn(function* () {
    const { path } = yield* ClientConfig;
    yield* Effect.sync(() => rmSync(path, { force: true }));
    yield* out({ removed: path }, () => "Back to the local server.");
  }, reported),
).pipe(Command.withDescription("Back to the local server"));

export const serve = Command.make(
  "serve",
  {},
  Effect.fn(function* () {
    // Loaded only for this command: the rest of the CLI never needs the server's modules.
    const { main } = yield* Effect.promise(() => import("@/server/serve"));
    return yield* Effect.mapError(main, (e) => usage(e.message));
  }, reported),
).pipe(Command.withDescription("Run the API + PWA server"));

export const open = Command.make(
  "open",
  {},
  Effect.fn(function* () {
    const { url } = yield* ClientConfig;
    const opener = process.platform === "darwin" ? "open" : "xdg-open";
    yield* Effect.sync(() => Bun.spawn([opener, url]));
  }, reported),
).pipe(Command.withDescription("Open the PWA in a browser"));
