#!/usr/bin/env bun
// MCP (stdio) adapter over the HTTP API, so Claude Code gets native scratchpad tools. It stays at
// this path because `claude mcp add` records it; the tools are in mcp/.
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunStdio from "@effect/platform-bun/BunStdio";
import * as McpServer from "effect/ai/McpServer";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";

import { Client } from "@/client/client";
import { ClientConfig } from "@/config/client";
import { Handlers } from "@/mcp/handlers";
import { Server } from "@/mcp/server";
import { Scratchpad } from "@/mcp/tools";

const Author = Config.String("PAD_AUTHOR").pipe(Config.withDefault("claude-code"));

McpServer.toolkit(Scratchpad).pipe(
  Layer.provide(Handlers),
  Layer.provide(
    Layer.unwrap(
      Effect.gen(function* () {
        return Client.layer(yield* Author);
      }),
    ),
  ),
  Layer.provide(Server),
  Layer.provide([ClientConfig.layer, BunStdio.layer]),
  // stdout is the protocol; anything logged goes to stderr.
  Layer.provide(Layer.succeed(Logger.LogToStderr, true)),
  Layer.launch,
  BunRuntime.runMain,
);
