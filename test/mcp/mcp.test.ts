import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";

import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ROOT, type TestServer, testServer } from "@test/support";

// The MCP server as Claude Code runs it: a child process on stdio, driven by the reference SDK
// client, in front of a real API server.
let server: TestServer;
let mcp: McpClient;

beforeAll(async () => {
  server = await testServer();
  mcp = new McpClient({ name: "test", version: "0" });
  await mcp.connect(
    new StdioClientTransport({
      command: "bun",
      args: [join(ROOT, "src", "mcp.ts")],
      env: {
        ...(process.env as Record<string, string>),
        PAD_URL: server.url.origin,
        PAD_TOKEN: "",
        PAD_AUTHOR: "",
        XDG_CONFIG_HOME: "/nonexistent",
      },
    }),
  );
});

afterAll(async () => {
  await mcp.close();
  await server.stop();
});

type Text = { content: { type: string; text: string }[]; isError?: boolean };
const call = async (name: string, args: Record<string, unknown>) => {
  const result = (await mcp.callTool({ name, arguments: args })) as Text;
  const text = result.content[0]?.text ?? "";
  return { isError: result.isError ?? false, text, data: result.isError ? null : JSON.parse(text) };
};

describe("MCP server", () => {
  test("tells the agent what the scratchpad is for", () => {
    expect(mcp.getInstructions()).toContain("kind reference + tags checklist, launch");
    expect(mcp.getInstructions()).toContain(server.url.origin);
  });

  test("lists every tool with its hints", async () => {
    const { tools } = await mcp.listTools();
    expect(tools.map((t) => t.name).toSorted()).toEqual(
      [
        "scratchpad_append",
        "scratchpad_create",
        "scratchpad_delete",
        "scratchpad_diff",
        "scratchpad_get",
        "scratchpad_history",
        "scratchpad_search",
        "scratchpad_update",
      ].toSorted(),
    );
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(byName.scratchpad_search?.annotations).toMatchObject({
      title: "Search scratchpad",
      readOnlyHint: true,
    });
    expect(byName.scratchpad_delete?.annotations?.destructiveHint).toBe(true);
    expect(byName.scratchpad_search?.inputSchema.properties).toHaveProperty("query");
  });

  test("writes are attributed to claude-code and found again by search", async () => {
    const created = await call("scratchpad_create", { body: "# MCP note\nhello", tags: ["mcp"] });
    expect(created.data).toMatchObject({ title: "MCP note", author: "claude-code", tags: ["mcp"] });
    await call("scratchpad_append", { id: created.data.id, text: "- [ ] more" });

    const found = await call("scratchpad_search", { query: "hello" });
    expect(found.data).toHaveLength(1);
    expect(found.data[0]).toMatchObject({ id: created.data.id, progress: { done: 0, total: 1 } });
    expect(found.data[0].body).toBeUndefined();

    const history = await call("scratchpad_history", { id: created.data.id });
    expect(history.data.map((r: { author: string }) => r.author)).toEqual(["claude-code"]);
  });

  test("an API error comes back as a tool error with its message", async () => {
    const missing = await call("scratchpad_get", { id: "no-such-note" });
    expect([missing.isError, missing.text]).toEqual([true, "Note not found"]);
  });

  test("invalid arguments are refused before reaching the API", async () => {
    const bad = await call("scratchpad_create", { body: "x", kind: "memo" }).catch((e: Error) => ({
      isError: true,
      text: e.message,
    }));
    expect(bad.isError).toBe(true);
  });
});
