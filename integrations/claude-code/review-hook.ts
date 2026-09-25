#!/usr/bin/env bun
// Claude Code Stop hook: after a turn that edited files, asks Claude to check them against the
// reference notes that apply (see review.ts). Lets Claude stop silently when nothing was edited,
// when the review already ran this turn, with PAD_REVIEW=off, or when the server is unreachable.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { basename } from "node:path";

import { Client } from "../../src/client";
import { config } from "../../src/config";
import { editsPath, reviewReason } from "./review";
import { withTimeout } from "./timeout";

const event = await Bun.stdin.json().catch(() => ({}));
const file = editsPath(String(event.session_id ?? "unknown"));
const files = existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
// Each batch of edits is reviewed at most once, whatever happens below.
rmSync(file, { force: true });

// `stop_hook_active` means this turn is Claude answering our own review, so its edits are the
// review's fixes, not new work to review.
if (files.length && !event.stop_hook_active && process.env.PAD_REVIEW !== "off") {
  try {
    const notes = await withTimeout(
      new Client(config.url, "claude-code").list({ kind: "reference", limit: 100 }),
    );
    if (notes.length) {
      const cwd = typeof event.cwd === "string" ? event.cwd : process.cwd();
      const root = Bun.spawnSync(["git", "-C", cwd, "rev-parse", "--show-toplevel"]);
      const repo = basename(root.success ? root.stdout.toString().trim() : cwd);
      console.log(
        JSON.stringify({ decision: "block", reason: reviewReason({ files, cwd, repo, notes }) }),
      );
    }
  } catch {
    // Server down or slow: finishing the turn matters more than the review.
  }
}
process.exit(0); // don't wait on the pending timeout timer
