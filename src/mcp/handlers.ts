// What each tool does: a call to the HTTP API, through the same Client the CLI uses.
import * as Effect from "effect/Effect";

import { Client } from "@/client/client";
import type { Note } from "@/shared/domain";

import { Scratchpad } from "./tools";

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

export const Handlers = Scratchpad.toLayer(
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
