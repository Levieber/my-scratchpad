// The Claude Code hooks, run as `pad hook <name>` so they start as fast as the compiled `pad`.
// Each reads Claude Code's event (JSON on stdin) and writes its answer on stdout. A hook must never
// hold Claude up: past a timeout, or on any failure at all, it does nothing.
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname } from "node:path";

import * as Console from "effect/Console";
import * as Effect from "effect/Effect";

import { hookSections } from "@/client/hook-notes";
import { locate } from "@/client/location";
import { ClientConfig } from "@/config/client";
import { HookConfig } from "@/config/hooks";
import type { HookSection, Note } from "@/shared/domain";
// The hooks that show notes; this file's own HookName is every hook Claude Code runs.
import type { HookName as NotesHook } from "@/shared/hooks";

import { editedFile, editsPath, reviewReason } from "./review";

type HookEvent = {
  session_id?: unknown;
  cwd?: unknown;
  stop_hook_active?: unknown;
  tool_input?: unknown;
};

const quietly = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.timeout("1500 millis"), Effect.ignoreCause);

const cwdOf = (event: HookEvent) =>
  typeof event.cwd === "string" && event.cwd ? event.cwd : process.cwd();

/** A section's heading: where its notes come from, and the search that picked them. */
function sectionHeading(hook: NotesHook, s: HookSection) {
  const what = s.query ?? "hand-picked";
  if (s.scope) return `Notes for ${s.scope} (${what})`;
  if (s.source === "default") return hook === "session-start" ? "Recent notes" : "Reference notes";
  return `Notes selected by the user (${what})`;
}

// Titles only: anything more would spend context in every session.
const noteLine = (s: HookSection) => (n: Note) =>
  `- ${n.title} (id: ${n.id}, ${n.author}, ${n.updated_at.slice(0, 10)}${s.include.includes(n.id) ? ", hand-picked" : ""})`;

/** The sections with notes, each under its heading; what the session sees and `pad hooks preview` shows. */
export const sectionsText = (hook: NotesHook, sections: readonly HookSection[]) =>
  sections
    .filter((s) => s.notes.length)
    .map((s) => `## ${sectionHeading(hook, s)}\n${s.notes.map(noteLine(s)).join("\n")}`)
    .join("\n\n");

/**
 * SessionStart: tells Claude the scratchpad exists and lists the titles of the notes chosen for
 * where it works (`pad hooks`): by default the most recently changed ones that aren't
 * references, plus whatever the user chose for this repository or folder.
 */
export const sessionStart = (event: HookEvent) =>
  quietly(
    Effect.gen(function* () {
      const { url } = yield* ClientConfig;
      const { chosen } = yield* HookConfig;
      const sections = yield* hookSections(
        "session-start",
        locate(cwdOf(event)),
        chosen["session-start"],
      );
      const custom = sections.some((s) => s.source !== "default");
      const listed = sectionsText("session-start", sections);

      const context = [
        `# Scratchpad (${url})`,
        "The user's shared scratchpad is available via the `scratchpad_*` MCP tools (or the `pad` CLI).",
        "Search it before asking the user to repeat context; save things they ask you to remember; append progress logs on long tasks.",
        // By default reference notes stay out of this context: they load on demand (`review`). Not
        // said when the user chose the notes, since their choice may well include references.
        custom
          ? ""
          : "The user's reference notes (practices, principles, checklists) aren't loaded here: after a turn that edits files you'll be asked to check the edits against the ones that apply.",
        listed ? `\n${listed}` : "",
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
 * Stop: after a turn that edited files, asks Claude to check them against the reference notes
 * chosen for where it works (see review.ts). Silent when nothing was edited, when the review
 * already ran this turn, with PAD_REVIEW=off, or when the server is unreachable.
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
      const { chosen } = yield* HookConfig;
      const cwd = cwdOf(event);
      const at = locate(cwd);
      const sections = yield* hookSections("review", at, chosen.review);
      const notes = sections.flatMap((s) => s.notes);
      if (!notes.length) return;
      const repo = at.repo ?? basename(cwd);
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
