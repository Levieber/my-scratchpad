// Markdown task lists (`- [ ] item`), read out of note bodies. Pure, so storage and clients share it.

const BOX = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\](?:\s+(.*))?$/;

// A fence opens with three or more backticks or tildes (a backtick fence's info string has no
// backtick) and closes on the same character, at least as many, with nothing after them.
const OPEN = /^\s*(`{3,}(?=[^`]*$)|~{3,})/;

export type Task = { /** 0-based line in the body. */ line: number; done: boolean };

/**
 * Each checkbox item outside code fences, in order. An example in a fence isn't a task, and
 * neither is an empty `- [ ]` placeholder (templates leave one to type into). The PWA's Read view
 * maps its Nth rendered checkbox to the Nth of these, so this is what a tick edits, and a fence
 * has to close where the renderer closes it: a shorter fence inside a longer one is only text.
 */
export function tasks(body: string): Task[] {
  const found: Task[] = [];
  let fence: string | null = null;
  for (const [line, text] of body.split("\n").entries()) {
    if (fence) {
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(text)?.[1];
      if (close && close[0] === fence[0] && close.length >= fence.length) fence = null;
      continue;
    }
    const open = OPEN.exec(text)?.[1];
    if (open) {
      fence = open;
      continue;
    }
    const m = BOX.exec(text);
    if (m && (m[2] ?? "").trim()) found.push({ line, done: m[1] !== " " });
  }
  return found;
}

export type Progress = { done: number; total: number };

export function progress(body: string): Progress {
  const all = tasks(body);
  return { done: all.filter((b) => b.done).length, total: all.length };
}
