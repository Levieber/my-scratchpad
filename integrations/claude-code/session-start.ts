#!/usr/bin/env bun
// Claude Code SessionStart hook: tells Claude the scratchpad exists and lists the most recent
// note titles as context. Stays silent and fast if the server is unreachable.
import { Client } from "@/client";
import { config } from "@/config";

import { withTimeout } from "./timeout";

const client = new Client(config.url, "claude-code");

try {
  const recent = await withTimeout(client.list({ limit: 8 }));

  const recentText = recent
    .map((n) => `- ${n.title} (id: ${n.id}, ${n.author}, ${n.updated_at.slice(0, 10)})`)
    .join("\n");

  const context = [
    `# Scratchpad (${config.url})`,
    "The user's shared scratchpad is available via the `scratchpad_*` MCP tools (or the `pad` CLI).",
    "Search it before asking the user to repeat context; save things they ask you to remember; append progress logs on long tasks.",
    // Reference notes stay out of this context on purpose: they load on demand (review-hook.ts).
    "The user's reference notes (practices, principles, checklists) aren't loaded here: after a turn that edits files you'll be asked to check the edits against the ones that apply.",
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
