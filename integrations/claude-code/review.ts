// The on-demand review. Reference notes (practices, principles, checklists) aren't loaded at
// session start; after a turn that edited files, the Stop hook lists their titles and asks Claude
// to check the edits against the ones that apply. The hooks are thin; the decisions live here.
import { homedir } from "node:os";
import { isAbsolute, join, relative } from "node:path";

import type { Note } from "@/domain";

/** Where a session's edited paths are kept between the PostToolUse and Stop hooks. */
export const editsPath = (
  sessionId: string,
  base = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"),
) => join(base, "scratchpad", "edits", `${sessionId.replace(/[^\w-]/g, "_")}.txt`);

/** The file an Edit, Write, MultiEdit or NotebookEdit event changed. */
export function editedFile(event: unknown): string | undefined {
  const input = (event as { tool_input?: Record<string, unknown> } | null)?.tool_input;
  const path = input?.file_path ?? input?.notebook_path;
  return typeof path === "string" && path ? path : undefined;
}

export const MAX_FILES = 30;

type Reference = Pick<Note, "id" | "title" | "tags">;

export function reviewReason({
  files,
  cwd,
  repo,
  notes,
}: {
  files: string[];
  cwd: string;
  repo: string;
  notes: Reference[];
}): string {
  const unique = [...new Set(files)];
  const shown = unique.slice(0, MAX_FILES).map((f) => {
    const r = relative(cwd, f);
    return `- ${r && !r.startsWith("..") && !isAbsolute(r) ? r : f}`;
  });
  if (unique.length > MAX_FILES) shown.push(`- … and ${unique.length - MAX_FILES} more`);
  return [
    `Before you finish: this turn edited files in ${repo}:`,
    ...shown,
    "",
    "The user's reference notes (practices, principles, checklists), titles only:",
    ...notes.map(
      (n) => `- ${n.title} (id: ${n.id})${n.tags.length ? " #" + n.tags.join(" #") : ""}`,
    ),
    "",
    "Follow the pad-review skill: pick only the notes that fit these edits (often none), read those with scratchpad_get, check the changes against them, fix clear violations, and report in a few lines, or one line if nothing applies.",
  ].join("\n");
}
