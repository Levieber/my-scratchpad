// What each tool does: a call to the HTTP API, through the same Client the CLI uses.
import * as Effect from "effect/Effect";

import { Client } from "@/client/client";
import { hookSections } from "@/client/hook-notes";
import { locate } from "@/client/location";
import { HookConfig } from "@/config/hooks";
import type { Note } from "@/shared/domain";
import { HOOK_NAMES } from "@/shared/hooks";

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
    const { chosen } = yield* HookConfig;

    // Each hook's stored choices and what it shows at `cwd`, as titles: what the hooks put in
    // front of the agent, plus why.
    const hooks = Effect.fnUntraced(function* (cwd: string) {
      const here = locate(cwd);
      const info = yield* client.hooks();
      const shown = yield* Effect.forEach(HOOK_NAMES, (name) =>
        hookSections(name, here, chosen[name]).pipe(Effect.provideService(Client, client)),
      );
      return {
        here,
        max_include: info.max_include,
        hooks: info.hooks.map((h, i) => ({
          ...h,
          shown_here: (shown[i] ?? []).map(({ scope, query, source, notes }) => ({
            scope,
            query,
            source,
            notes: notes.map(({ id, title }) => ({ id, title })),
          })),
        })),
      };
    });

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
      scratchpad_hooks: ({ cwd }) => hooks(cwd ?? process.cwd()),
    });
  }),
);
