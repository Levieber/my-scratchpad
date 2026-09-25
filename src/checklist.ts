// Markdown task lists (`- [ ] item`), read out of note bodies. Pure, so storage and clients share it.

const BOX = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\](?:\s+(.*))?$/;

/**
 * Each checkbox item outside code fences. An example in a fence isn't a task, and neither is an
 * empty `- [ ]` placeholder (templates leave one to type into).
 */
function boxes(body: string): { done: boolean; text: string }[] {
  const found: { done: boolean; text: string }[] = [];
  let fenced = false;
  for (const line of body.split("\n")) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const m = fenced ? null : BOX.exec(line);
    const text = (m?.[2] ?? "").trim();
    if (m && text) found.push({ done: m[1] !== " ", text });
  }
  return found;
}

export type Progress = { done: number; total: number };

export function progress(body: string): Progress {
  const all = boxes(body);
  return { done: all.filter((b) => b.done).length, total: all.length };
}

/** Unticked items, for carrying them over to the next daily review. */
export const openItems = (body: string): string[] =>
  boxes(body)
    .filter((b) => !b.done)
    .map((b) => b.text);
