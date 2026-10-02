#!/usr/bin/env bun
// MCP (stdio) adapter over the HTTP API, so Claude Code gets native scratchpad tools.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { Client } from "./client";
import { config } from "./config";
import type { Note } from "./db";
import { type Kind, KIND_NAMES, KINDS } from "./kinds";

const client = new Client(config.url, process.env.PAD_AUTHOR ?? "claude-code");

const server = new McpServer(
  { name: "scratchpad", version: "0.1.0" },
  {
    instructions: `The user's personal scratchpad, shared between them (via a PWA and the \`pad\` CLI) and you.
Use it to: look up context the user jotted down (search before asking them to repeat themselves), save notes/findings/TODOs they ask you to remember, and keep a running log on long tasks.
Your writes are attributed as "claude-code". Web UI: ${config.url}
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
      "List or full-text search the user's scratchpad notes. Most recently updated first. Returns previews; use scratchpad_get for the full body.",
    inputSchema: {
      query: z
        .string()
        .optional()
        .describe(
          "Full-text search terms; omit to list recent notes. Also takes `kind:reference`, `author:agent` and `#tag` operators",
        ),
      tags: z.array(z.string()).optional().describe("Notes must carry all of these"),
      kind,
      author: z
        .string()
        .optional()
        .describe("human, agent (anyone who isn't the human), or an author's name"),
      limit: z.number().int().min(1).max(100).optional().describe("Default 20"),
    },
    annotations: { readOnlyHint: true },
  },
  safe(async ({ query, tags, kind, author, limit }) =>
    (await client.list({ q: query, tag: tags, kind, author, limit: limit ?? 20 })).map(summary),
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
    },
  },
  safe((args) => client.create(args)),
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
    description: "Replace a note's title, body, tags or kind. Omitted fields are unchanged.",
    inputSchema: {
      id: z.string(),
      title: z.string().optional(),
      body: z.string().optional(),
      tags,
      kind,
    },
    annotations: { idempotentHint: true },
  },
  safe(({ id, ...patch }) => client.update(id, patch)),
);

server.registerTool(
  "scratchpad_history",
  {
    title: "Note history",
    description:
      "List a note's revisions, newest first: who changed it, when, and how many lines were added/removed. Use scratchpad_diff to see a change.",
    inputSchema: {
      id: z.string(),
      limit: z.number().int().min(1).max(100).optional().describe("Default 20"),
    },
    annotations: { readOnlyHint: true },
  },
  safe(({ id, limit }) => client.revisions(id, { limit: limit ?? 20 })),
);

server.registerTool(
  "scratchpad_diff",
  {
    title: "Diff note",
    description:
      "Show what changed in a note as a unified diff (plus title/tags/kind changes). Defaults to the latest change. Pass `since` (e.g. the updated_at you last read) to see everything the user changed after that.",
    inputSchema: {
      id: z.string(),
      since: z.string().optional().describe("ISO date-time; compare with the note as it was then"),
      from: z.number().int().optional().describe("Revision id (from scratchpad_history)"),
      to: z.number().int().optional().describe("Revision id; default the latest"),
    },
    annotations: { readOnlyHint: true },
  },
  safe(({ id, ...q }) => client.diff(id, q)),
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
