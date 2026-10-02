// The Claude Code hooks, run as `pad hook <name>` so they start as fast as the compiled `pad`.
// Each reads Claude Code's event (JSON on stdin) and writes its answer on stdout. A hook must never
// hold Claude up: past a timeout, or on any failure at all, it does nothing.
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname } from "node:path";

import * as Console from "effect/Console";
import * as Effect from "effect/Effect";

import { Client } from "@/client";
import { ClientConfig } from "@/config";

import { editedFile, editsPath, reviewReason } from "./review";

type HookEvent = {
  session_id?: unknown;
  cwd?: unknown;
  stop_hook_active?: unknown;
  tool_input?: unknown;
};

const quietly = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.timeout("1500 millis"), Effect.ignoreCause);

/** SessionStart: tells Claude the scratchpad exists and lists the most recent note titles. */
export const sessionStart = (_event: HookEvent) =>
  quietly(
    Effect.gen(function* () {
      const { url } = yield* ClientConfig;
      const recent = yield* (yield* Client).list({ limit: 8 });

      const recentText = recent
        .map((n) => `- ${n.title} (id: ${n.id}, ${n.author}, ${n.updated_at.slice(0, 10)})`)
        .join("\n");

      const context = [
        `# Scratchpad (${url})`,
        "The user's shared scratchpad is available via the `scratchpad_*` MCP tools (or the `pad` CLI).",
        "Search it before asking the user to repeat context; save things they ask you to remember; append progress logs on long tasks.",
        // Reference notes stay out of this context on purpose: they load on demand (`review`).
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
    }),
  );

/**
 * PostToolUse (Edit|Write|MultiEdit|NotebookEdit): remembers which files the session changed, for
 * the review at the end of the turn. Never blocks.
 */
export const recordEdit = (event: HookEvent) =>
  quietly(
    Effect.sync(() => {
      const file = editedFile(event);
      if (!file || typeof event.session_id !== "string") return;
      const path = editsPath(event.session_id);
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, file + "\n");
    }),
  );

/**
 * Stop: after a turn that edited files, asks Claude to check them against the reference notes that
 * apply (see review.ts). Silent when nothing was edited, when the review already ran this turn,
 * with PAD_REVIEW=off, or when the server is unreachable.
 */
export const review = (event: HookEvent) =>
  quietly(
    Effect.gen(function* () {
      const file = editsPath(typeof event.session_id === "string" ? event.session_id : "unknown");
      const files = existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
      // Each batch of edits is reviewed at most once, whatever happens below.
      rmSync(file, { force: true });

      // `stop_hook_active` means this turn is Claude answering our own review, so its edits are
      // the review's fixes, not new work to review.
      if (!files.length || event.stop_hook_active || process.env.PAD_REVIEW === "off") return;
      const notes = yield* (yield* Client).list({ kind: "reference", limit: 100 });
      if (!notes.length) return;
      const cwd = typeof event.cwd === "string" ? event.cwd : process.cwd();
      const root = Bun.spawnSync(["git", "-C", cwd, "rev-parse", "--show-toplevel"]);
      const repo = basename(root.success ? root.stdout.toString().trim() : cwd);
      yield* Console.log(
        JSON.stringify({ decision: "block", reason: reviewReason({ files, cwd, repo, notes }) }),
      );
    }),
  );

/** Every hook by the name `pad hook <name>` takes; settings.ts installs one per event. */
export const HOOK_RUNNERS = {
  "session-start": sessionStart,
  "record-edit": recordEdit,
  review,
} as const;

export type HookName = keyof typeof HOOK_RUNNERS;
