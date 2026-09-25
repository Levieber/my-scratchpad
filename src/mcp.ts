#!/usr/bin/env bun
// MCP (stdio) adapter over the HTTP API, so Claude Code gets native scratchpad tools.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { Client } from "./client";
import { config } from "./config";
import { localDate } from "./daily";
import type { Note } from "./db";
import { type Kind, KIND_NAMES, KINDS } from "./kinds";

const client = new Client(config.url, process.env.PAD_AUTHOR ?? "claude-code");

const server = new McpServer(
  { name: "scratchpad", version: "0.1.0" },
  {
    instructions: `The user's personal scratchpad, shared between them (via a PWA and the \`pad\` CLI) and you.
Use it to: look up context the user jotted down (search before asking them to repeat themselves), save notes/findings/TODOs they ask you to remember, and keep a running log on long tasks.
Pinned notes are the user's most important context. Your writes are attributed as "claude-code". Web UI: ${config.url}
Every note has a kind: ${KIND_NAMES.map((k) => `\`${k}\` (${KINDS[k]})`).join("; ")} A use case is a tag, not a kind: a launch checklist is kind reference + tags checklist, launch.`,
  },
);

const text = (data: unknown) => ({
  content: [
    {
      type: "text" as const,
      text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
    },
  ],
});

// Wrap handlers so API errors surface as tool errors instead of crashing the server.
const safe =
  <A>(fn: (args: A) => Promise<unknown>) =>
  async (args: A) => {
    try {
      return text(await fn(args));
    } catch (e) {
      return { ...text(e instanceof Error ? e.message : String(e)), isError: true };
    }
  };

// Keep list output compact; full bodies only via scratchpad_get.
const summary = (n: Note) => ({
  id: n.id,
  title: n.title,
  tags: n.tags,
  pinned: n.pinned,
  kind: n.kind,
  ...(n.progress.total > 0 && { progress: n.progress }),
  author: n.author,
  updated_at: n.updated_at,
  preview: n.body.length > 200 ? n.body.slice(0, 200) + "…" : n.body,
});

const tags = z.array(z.string()).optional().describe("Lowercase tags, e.g. ['project-x', 'todo']");
const kind = z
  .enum(KIND_NAMES as [Kind, ...Kind[]])
  .optional()
  .describe("note (default) or reference (reusable rules: practices, principles, checklists)");

server.registerTool(
  "scratchpad_search",
  {
    title: "Search scratchpad",
    description:
      "List or full-text search the user's scratchpad notes. Pinned first, then most recently updated. Returns previews; use scratchpad_get for the full body.",
    inputSchema: {
      query: z
        .string()
        .optional()
        .describe(
          "Full-text search terms; omit to list recent notes. Also takes `kind:reference` and `#tag` operators",
        ),
      tags: z.array(z.string()).optional().describe("Notes must carry all of these"),
      kind,
      pinned: z.boolean().optional().describe("Only pinned notes"),
      limit: z.number().int().min(1).max(100).optional().describe("Default 20"),
    },
    annotations: { readOnlyHint: true },
  },
  safe(async ({ query, tags, kind, pinned, limit }) =>
    (await client.list({ q: query, tag: tags, kind, pinned, limit: limit ?? 20 })).map(summary),
  ),
);

server.registerTool(
  "scratchpad_get",
  {
    title: "Read note",
    description: "Get one scratchpad note with its full markdown body.",
    inputSchema: { id: z.string() },
    annotations: { readOnlyHint: true },
  },
  safe(({ id }) => client.get(id)),
);

server.registerTool(
  "scratchpad_create",
  {
    title: "Create note",
    description: "Create a scratchpad note (markdown). Title defaults to the body's first line.",
    inputSchema: {
      body: z.string(),
      title: z.string().optional(),
      tags,
      kind,
      pinned: z.boolean().optional(),
    },
  },
  safe((args) => client.create(args)),
);

server.registerTool(
  "scratchpad_daily",
  {
    title: "Daily review",
    description:
      "Get the user's daily review note for a date, creating it (with open items carried over from the previous one) if it doesn't exist. Use when the user asks about today's plan, what's left, or a daily review.",
    inputSchema: {
      date: z.string().optional().describe("YYYY-MM-DD; defaults to today in the user's time zone"),
    },
    annotations: { idempotentHint: true },
  },
  safe(({ date }) => client.daily(date ?? localDate())),
);

server.registerTool(
  "scratchpad_append",
  {
    title: "Append to note",
    description:
      "Append text to an existing note on a new line. Prefer this for logs, journals and running lists.",
    inputSchema: { id: z.string(), text: z.string() },
  },
  safe(({ id, text }) => client.append(id, text)),
);

server.registerTool(
  "scratchpad_update",
  {
    title: "Update note",
    description: "Replace a note's title, body, tags or pinned flag. Omitted fields are unchanged.",
    inputSchema: {
      id: z.string(),
      title: z.string().optional(),
      body: z.string().optional(),
      tags,
      kind,
      pinned: z.boolean().optional(),
    },
    annotations: { idempotentHint: true },
  },
  safe(({ id, ...patch }) => client.update(id, patch)),
);

server.registerTool(
  "scratchpad_delete",
  {
    title: "Delete note",
    description: "Permanently delete a scratchpad note. Only do this when the user asks.",
    inputSchema: { id: z.string() },
    annotations: { destructiveHint: true },
  },
  safe(async ({ id }) => {
    await client.delete(id);
    return { deleted: id };
  }),
);

await server.connect(new StdioServerTransport());
