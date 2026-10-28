// The MCP server over HTTP, for claude.ai's connectors: `bun src/mcp-http.ts` (`bun run
// start:mcp` on Railway). It stays at this path because Railway's start command names it; the
// code is in mcp/http.ts.
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as Effect from "effect/Effect";

import { ClientConfig } from "@/config/client";
import { main, teardown } from "@/mcp/http";

BunRuntime.runMain(main.pipe(Effect.provide(ClientConfig.layer)), { teardown });
