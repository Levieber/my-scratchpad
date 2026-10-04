// Markdown task lists (`- [ ] item`), read out of note bodies. Pure, so storage and clients share it.

const BOX = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\](?:\s+(.*))?$/;

export type Task = { /** 0-based line in the body. */ line: number; done: boolean };

/**
 * Each checkbox item outside code fences, in order. An example in a fence isn't a task, and
 * neither is an empty `- [ ]` placeholder (templates leave one to type into). The PWA's Read view
 * maps its Nth rendered checkbox to the Nth of these, so this is what a tick edits.
 */
export function tasks(body: string): Task[] {
  const found: Task[] = [];
  let fenced = false;
  for (const [line, text] of body.split("\n").entries()) {
    if (/^\s*```/.test(text)) fenced = !fenced;
    const m = fenced ? null : BOX.exec(text);
    if (m && (m[2] ?? "").trim()) found.push({ line, done: m[1] !== " " });
  }
  return found;
}

export type Progress = { done: number; total: number };

export function progress(body: string): Progress {
  const all = tasks(body);
  return { done: all.filter((b) => b.done).length, total: all.length };
}
