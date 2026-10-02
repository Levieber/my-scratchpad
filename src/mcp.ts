#!/usr/bin/env bun
// MCP (stdio) adapter over the HTTP API, so Claude Code gets native scratchpad tools.
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunStdio from "@effect/platform-bun/BunStdio";
import * as McpProtocol from "effect/ai/McpProtocol";
import * as McpServer from "effect/ai/McpServer";
import * as Tool from "effect/ai/Tool";
import * as Toolkit from "effect/ai/Toolkit";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Schema from "effect/Schema";

import { ApiError, Client } from "./client";
import { ClientConfig } from "./config";
import { Kind, type Note } from "./domain";
import { KIND_NAMES, KINDS } from "./kinds";

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

const described = <S extends Schema.Top>(schema: S, description: string) =>
  schema.annotate({ description });

const tags = Schema.optional(
  described(
    Schema.mutable(Schema.Array(Schema.String)),
    "Lowercase tags, e.g. ['project-x', 'todo']",
  ),
);
const kind = Schema.optional(
  described(
    Kind,
    "note (default) or reference (reusable rules: practices, principles, checklists)",
  ),
);
const limit = Schema.optional(
  described(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })), "Default 20"),
);
const id = Schema.String;

// Every tool answers with the API's JSON, and fails with its error message.
const tool = <const Name extends string, Fields extends Schema.Struct.Fields>(
  name: Name,
  description: string,
  fields: Fields,
) =>
  Tool.make(name, {
    description,
    parameters: Schema.Struct(fields),
    success: Schema.Unknown,
    failure: ApiError,
  });

const Search = tool(
  "scratchpad_search",
  "List or full-text search the user's scratchpad notes. Most recently updated first. Returns previews; use scratchpad_get for the full body.",
  {
    query: Schema.optional(
      described(
        Schema.String,
        "Full-text search terms; omit to list recent notes. Also takes `kind:reference`, `author:agent` and `#tag` operators",
      ),
    ),
    tags: Schema.optional(described(Schema.Array(Schema.String), "Notes must carry all of these")),
    kind,
    author: Schema.optional(
      described(Schema.String, "human, agent (anyone who isn't the human), or an author's name"),
    ),
    limit,
  },
)
  .annotate(Tool.Title, "Search scratchpad")
  .annotate(Tool.Readonly, true);

const Get = tool("scratchpad_get", "Get one scratchpad note with its full markdown body.", { id })
  .annotate(Tool.Title, "Read note")
  .annotate(Tool.Readonly, true);

const Create = tool(
  "scratchpad_create",
  "Create a scratchpad note (markdown). Title defaults to the body's first line.",
  { body: Schema.String, title: Schema.optional(Schema.String), tags, kind },
).annotate(Tool.Title, "Create note");

const Append = tool(
  "scratchpad_append",
  "Append text to an existing note on a new line. Prefer this for logs, journals and running lists.",
  { id, text: Schema.String },
).annotate(Tool.Title, "Append to note");

const Update = tool(
  "scratchpad_update",
  "Replace a note's title, body, tags or kind. Omitted fields are unchanged.",
  {
    id,
    title: Schema.optional(Schema.String),
    body: Schema.optional(Schema.String),
    tags,
    kind,
  },
)
  .annotate(Tool.Title, "Update note")
  .annotate(Tool.Idempotent, true);

const History = tool(
  "scratchpad_history",
  "List a note's revisions, newest first: who changed it, when, and how many lines were added/removed. Use scratchpad_diff to see a change.",
  { id, limit },
)
  .annotate(Tool.Title, "Note history")
  .annotate(Tool.Readonly, true);

const Diff = tool(
  "scratchpad_diff",
  "Show what changed in a note as a unified diff (plus title/tags/kind changes). Defaults to the latest change. Pass `since` (e.g. the updated_at you last read) to see everything the user changed after that.",
  {
    id,
    since: Schema.optional(
      described(Schema.String, "ISO date-time; compare with the note as it was then"),
    ),
    from: Schema.optional(described(Schema.Int, "Revision id (from scratchpad_history)")),
    to: Schema.optional(described(Schema.Int, "Revision id; default the latest")),
  },
)
  .annotate(Tool.Title, "Diff note")
  .annotate(Tool.Readonly, true);

const Delete = tool(
  "scratchpad_delete",
  "Permanently delete a scratchpad note. Only do this when the user asks.",
  { id },
)
  .annotate(Tool.Title, "Delete note")
  .annotate(Tool.Destructive, true);

const Scratchpad = Toolkit.make(Search, Get, Create, Append, Update, History, Diff, Delete);

const Handlers = Scratchpad.toLayer(
  Effect.gen(function* () {
    const client = yield* Client;
    return Scratchpad.of({
      scratchpad_search: ({ query, tags, kind, author, limit }) =>
        Effect.map(
          client.list({ q: query, tag: tags, kind, author, limit: limit ?? 20 }),
          (notes) => notes.map(summary),
        ),
      scratchpad_get: ({ id }) => client.get(id),
      scratchpad_create: (input) => client.create(input),
      scratchpad_append: ({ id, text }) => client.append(id, text),
      scratchpad_update: ({ id, ...patch }) => client.update(id, patch),
      scratchpad_history: ({ id, limit }) => client.revisions(id, { limit: limit ?? 20 }),
      scratchpad_diff: ({ id, ...q }) => client.diff(id, q),
      scratchpad_delete: ({ id }) => Effect.as(client.delete(id), { deleted: id }),
    });
  }),
);

const Author = Config.String("PAD_AUTHOR").pipe(Config.withDefault("claude-code"));

const Server = Layer.unwrap(
  Effect.gen(function* () {
    const { url } = yield* ClientConfig;
    return McpServer.layerStdio({
      name: "scratchpad",
      version: "0.1.0",
      // Newest first; a client asking for an older revision gets that one.
      protocols: [
        McpProtocol.v2026_07_28,
        McpProtocol.v2025_11_25,
        McpProtocol.v2025_06_18,
        McpProtocol.v2025_03_26,
        McpProtocol.v2024_11_05,
      ],
      instructions: `The user's personal scratchpad, shared between them (via a PWA and the \`pad\` CLI) and you.
Use it to: look up context the user jotted down (search before asking them to repeat themselves), save notes/findings/TODOs they ask you to remember, and keep a running log on long tasks.
Your writes are attributed as "claude-code". Web UI: ${url}
Every note has a kind: ${KIND_NAMES.map((k) => `\`${k}\` (${KINDS[k]})`).join("; ")} A use case is a tag, not a kind: a launch checklist is kind reference + tags checklist, launch.`,
    });
  }),
);

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
