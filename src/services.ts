// The API and the MCP server over HTTP in one process: `bun src/services.ts` (Railway runs it
// compiled, /app/pad-services). A host that measures each container's memory counts Bun's runtime
// once per container, ~85 MB of it the executable's own pages, so two services pay it twice;
// one process pays it, and the runtime's heap, once (docs/deployment.md). Each keeps its port and
// its origin, and the MCP server still calls the API over HTTP, on loopback.
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";

import { ClientConfig } from "@/config/client";
import { port } from "@/config/env";
import { main as mcp } from "@/mcp/http";
import { main as server, teardown } from "@/server/serve";

const both = Effect.gen(function* () {
  const apiPort = yield* port;
  // The platform's PORT and public domain are the API's. Without them the MCP server takes
  // PAD_MCP_PORT (else 7778) and PAD_MCP_URL, which must name its own domain: an issuer at the
  // API's would sign every connector in at the wrong origin. PAD_URL is pinned to the API beside
  // it, so a stray one never sends its calls the long way.
  const mcpEnv = ConfigProvider.fromEnvRecord({
    ...process.env,
    PORT: undefined,
    RAILWAY_PUBLIC_DOMAIN: undefined,
    PAD_URL: `http://127.0.0.1:${apiPort}`,
  });
  // Either one failing ends the other and the process, so the platform restarts both.
  yield* Effect.all(
    [
      server,
      mcp.pipe(Effect.provide(ClientConfig.layer), Effect.provide(ConfigProvider.layer(mcpEnv))),
    ],
    { concurrency: "unbounded", discard: true },
  );
});

BunRuntime.runMain(both, { teardown });
