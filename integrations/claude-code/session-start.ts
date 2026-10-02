#!/usr/bin/env bun
// Claude Code SessionStart hook: tells Claude the scratchpad exists and lists the most recent
// note titles as context. Stays silent and fast if the server is unreachable.
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { Client } from "@/client";
import { ClientConfig } from "@/config";

import { quietly } from "./timeout";

const program = Effect.gen(function* () {
  const { url } = yield* ClientConfig;
  const recent = yield* (yield* Client).list({ limit: 8 });

  const recentText = recent
    .map((n) => `- ${n.title} (id: ${n.id}, ${n.author}, ${n.updated_at.slice(0, 10)})`)
    .join("\n");

  const context = [
    `# Scratchpad (${url})`,
    "The user's shared scratchpad is available via the `scratchpad_*` MCP tools (or the `pad` CLI).",
    "Search it before asking the user to repeat context; save things they ask you to remember; append progress logs on long tasks.",
    // Reference notes stay out of this context on purpose: they load on demand (review-hook.ts).
    "The user's reference notes (practices, principles, checklists) aren't loaded here: after a turn that edits files you'll be asked to check the edits against the ones that apply.",
    recent.length ? `\n## Recent notes\n${recentText}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  yield* Console.log(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context },
    }),
  );
});

await Effect.runPromise(
  quietly(program).pipe(
    Effect.provide(Layer.merge(Client.layer("claude-code"), ClientConfig.layer)),
  ),
);
