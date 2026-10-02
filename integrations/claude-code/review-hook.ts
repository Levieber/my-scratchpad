#!/usr/bin/env bun
// Claude Code Stop hook: after a turn that edited files, asks Claude to check them against the
// reference notes that apply (see review.ts). Lets Claude stop silently when nothing was edited,
// when the review already ran this turn, with PAD_REVIEW=off, or when the server is unreachable.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { basename } from "node:path";

import * as Console from "effect/Console";
import * as Effect from "effect/Effect";

import { Client } from "@/client";

import { editsPath, reviewReason } from "./review";
import { quietly } from "./timeout";

const event = await Bun.stdin.json().catch(() => ({}));
const file = editsPath(String(event.session_id ?? "unknown"));
const files = existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
// Each batch of edits is reviewed at most once, whatever happens below.
rmSync(file, { force: true });

// `stop_hook_active` means this turn is Claude answering our own review, so its edits are the
// review's fixes, not new work to review.
if (files.length && !event.stop_hook_active && process.env.PAD_REVIEW !== "off") {
  const review = Effect.gen(function* () {
    const notes = yield* (yield* Client).list({ kind: "reference", limit: 100 });
    if (!notes.length) return;
    const cwd = typeof event.cwd === "string" ? event.cwd : process.cwd();
    const root = Bun.spawnSync(["git", "-C", cwd, "rev-parse", "--show-toplevel"]);
    const repo = basename(root.success ? root.stdout.toString().trim() : cwd);
    yield* Console.log(
      JSON.stringify({ decision: "block", reason: reviewReason({ files, cwd, repo, notes }) }),
    );
  });
  // Server down or slow: finishing the turn matters more than the review.
  await Effect.runPromise(quietly(review).pipe(Effect.provide(Client.layer("claude-code"))));
}
