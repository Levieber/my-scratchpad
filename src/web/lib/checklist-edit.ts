// What the Read view does to a body: tick a task. The edit touches one line and leaves every
// other byte alone, so history shows a one-line diff and the outbox merges it like typing.
import { tasks } from "@/shared/checklist";

const MARK = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])\]/;

/**
 * The body with its `n`th task (as `progress` counts them) ticked or unticked; null when there
 * is no such task, so a stale click changes nothing.
 */
export function toggleTask(body: string, n: number): string | null {
  const task = tasks(body)[n];
  if (!task) return null;
  const lines = body.split("\n");
  lines[task.line] = lines[task.line]!.replace(MARK, (_, head: string) =>
    task.done ? `${head} ]` : `${head}x]`,
  );
  return lines.join("\n");
}
