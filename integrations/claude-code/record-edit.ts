#!/usr/bin/env bun
// Claude Code PostToolUse hook (Edit|Write|MultiEdit|NotebookEdit): remembers which files the
// session changed, for the review at the end of the turn (review-hook.ts). Never blocks.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { editedFile, editsPath } from "./review";

try {
  const event = await Bun.stdin.json();
  const file = editedFile(event);
  if (file && typeof event.session_id === "string") {
    const path = editsPath(event.session_id);
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, file + "\n");
  }
} catch {
  // A malformed event must not break the edit it follows.
}
