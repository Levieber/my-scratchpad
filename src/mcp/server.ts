// The MCP server itself: the protocol versions it speaks and the instructions Claude shows for it,
// the same over stdio (Claude Code) and over HTTP (claude.ai's connectors).
import * as McpProtocol from "effect/ai/McpProtocol";
import * as McpServer from "effect/ai/McpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ClientConfig } from "@/config/client";
import { KIND_NAMES, KINDS } from "@/shared/kinds";

/** Who the server says it is, and what it tells the agent, for the app at `url`. */
export const serverOptions = ({ url, author }: { url: string; author: string }) => ({
  name: "scratchpad",
  version: "0.1.0",
  // Newest first; a client asking for an older revision gets that one.
  protocols: [
    McpProtocol.v2026_07_28,
    McpProtocol.v2025_11_25,
    McpProtocol.v2025_06_18,
    McpProtocol.v2025_03_26,
    McpProtocol.v2024_11_05,
  ] as const,
  instructions: `The user's personal scratchpad, shared between them (via a PWA and the \`pad\` CLI) and you.
Use it to: look up context the user jotted down (search before asking them to repeat themselves), save notes/findings/TODOs they ask you to remember, and keep a running log on long tasks.
Your writes are attributed as "${author}". Web UI: ${url}
Every note has a kind: ${KIND_NAMES.map((k) => `\`${k}\` (${KINDS[k]})`).join("; ")} A use case is a tag, not a kind: a launch checklist is kind reference + tags checklist, launch.`,
});

/** Over stdio, for the app the client config points at. */
export const Server = (author: string) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const { url } = yield* ClientConfig;
      return McpServer.layerStdio(serverOptions({ url, author }));
    }),
  );
