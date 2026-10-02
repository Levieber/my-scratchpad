#!/usr/bin/env bun
// The `pad` executable (compiled by `bun run build:pad`, and the `bin` of package.json). It stays
// at this path; the commands are in cli/commands/, one file per area.
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import * as Command from "effect/cli/Command";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { login, logout, open, serve, status } from "@/cli/commands/connection";
import { ls, tags, views } from "@/cli/commands/find";
import { diff, history } from "@/cli/commands/history";
import { hook, hooks } from "@/cli/commands/hooks";
import { add, append, edit, rm, set, show } from "@/cli/commands/notes";
import { pin, pins, unpin } from "@/cli/commands/pins";
import { exportCmd, importCmd } from "@/cli/commands/transfer";
import { Author, pad } from "@/cli/root";
import { Client } from "@/client/client";
import { ClientConfig } from "@/config/client";
import { HookConfig } from "@/config/hooks";

const commands = [
  add,
  ls,
  show,
  append,
  edit,
  set,
  rm,
  pin,
  unpin,
  pins,
  history,
  diff,
  exportCmd,
  importCmd,
  tags,
  views,
  hooks,
  status,
  login,
  logout,
  serve,
  open,
  hook,
] as const;

pad.pipe(
  Command.withSubcommands(commands),
  Command.run({ version: "0.1.0" }),
  Effect.provide(
    Layer.mergeAll(
      Layer.unwrap(
        Effect.gen(function* () {
          return Client.layer(yield* Author);
        }),
      ),
      ClientConfig.layer,
      HookConfig.layer,
      BunServices.layer,
    ),
  ),
  BunRuntime.runMain,
);
