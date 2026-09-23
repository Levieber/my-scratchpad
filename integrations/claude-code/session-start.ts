#!/usr/bin/env bun
// Claude Code SessionStart hook: tells Claude the scratchpad exists and injects pinned notes
// plus recent titles as context. Stays silent and fast if the server is unreachable.
import { Client } from "../../src/client";
import { config } from "../../src/config";
import type { Note } from "../../src/db";

const MAX_PINNED_CHARS = 3000;

const withTimeout = <T>(p: Promise<T>, ms = 1500) =>
  Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);

const client = new Client(config.url, "claude-code");

try {
  const [pinned, recent] = await withTimeout(
    Promise.all([
      client.list({ pinned: true, limit: 10 }),
      client.list({ pinned: false, limit: 8 }),
    ]),
  );

  let budget = MAX_PINNED_CHARS;
  const pinnedText = pinned
    .map((n: Note) => {
      const body = n.body.slice(0, Math.max(0, budget));
      budget -= body.length;
      return `### ${n.title} (id: ${n.id})\n${body}${body.length < n.body.length ? "\n…(truncated; scratchpad_get for full)" : ""}`;
    })
    .join("\n\n");

  const recentText = recent
    .map((n) => `- ${n.title} (id: ${n.id}, ${n.author}, ${n.updated_at.slice(0, 10)})`)
    .join("\n");

  const context = [
    `# Scratchpad (${config.url})`,
    "The user's shared scratchpad is available via the `scratchpad_*` MCP tools (or the `pad` CLI).",
    "Search it before asking the user to repeat context; save things they ask you to remember; append progress logs on long tasks.",
    pinned.length ? `\n## Pinned notes\n${pinnedText}` : "",
    recent.length ? `\n## Recent notes\n${recentText}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  console.log(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context },
    }),
  );
} catch {
  // Server down or slow: don't block or clutter the session.
}
process.exit(0); // don't wait on the pending timeout timer
