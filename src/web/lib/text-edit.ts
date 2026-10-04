// The Write view's helpers: what a toolbar button or a shortcut does to the body and the selection.
// Pure, so they are tested without a textarea; each returns the new text and where the selection
// goes, and writes only the markdown a person would have typed.

/** A textarea's text and selection. */
export type TextSel = { value: string; start: number; end: number };

const lineStart = (value: string, at: number) => value.lastIndexOf("\n", at - 1) + 1;
const lineEnd = (value: string, at: number) => {
  const i = value.indexOf("\n", at);
  return i === -1 ? value.length : i;
};

/**
 * `**bold**` or `_italic_` around the selection, or taken off when it already has them; with
 * nothing selected, the pair with the cursor between.
 */
export function wrap({ value, start, end }: TextSel, mark: string): TextSel {
  const m = mark.length;
  const inner = value.slice(start, end);
  if (inner.length >= 2 * m && inner.startsWith(mark) && inner.endsWith(mark))
    return {
      value: value.slice(0, start) + inner.slice(m, -m) + value.slice(end),
      start,
      end: end - 2 * m,
    };
  if (value.slice(start - m, start) === mark && value.slice(end, end + m) === mark)
    return {
      value: value.slice(0, start - m) + inner + value.slice(end + m),
      start: start - m,
      end: end - m,
    };
  return {
    value: value.slice(0, start) + mark + inner + mark + value.slice(end),
    start: start + m,
    end: end + m,
  };
}

/** `[text](url)` from the selection, with `url` selected to type over; a selected address becomes the target. */
export function link({ value, start, end }: TextSel): TextSel {
  const inner = value.slice(start, end);
  const head = value.slice(0, start);
  const tail = value.slice(end);
  if (/^https?:\/\/\S+$/.test(inner))
    return { value: `${head}[](${inner})${tail}`, start: start + 1, end: start + 1 };
  const at = start + inner.length + 3;
  return { value: `${head}[${inner}](url)${tail}`, start: at, end: at + 3 };
}

export type LineKind = "heading" | "bullet" | "task";

const PREFIX: Record<LineKind, string> = { heading: "## ", bullet: "- ", task: "- [ ] " };

// What a line already starts with: an indent, then a heading, or a list item that may be a task.
const LINE = /^(\s*)(#{1,6}\s+|(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)?/;

const kindOf = (line: string): LineKind | null => {
  const p = LINE.exec(line)?.[2] ?? "";
  if (!p) return null;
  if (p.startsWith("#")) return "heading";
  return /\[[ xX]\]/.test(p) ? "task" : "bullet";
};

/**
 * Makes each line the selection touches a heading, a bullet or a task, in place of what it was;
 * when they all already are, makes them plain lines again.
 */
export function setLines(sel: TextSel, kind: LineKind): TextSel {
  const { value, start, end } = sel;
  const from = lineStart(value, start);
  const to = lineEnd(value, Math.max(start, end - (end > start ? 1 : 0)));
  const lines = value.slice(from, to).split("\n");
  const off = lines.every((l) => kindOf(l) === kind);
  const deltas: number[] = [];
  const next = lines.map((line) => {
    const [whole = "", indent = ""] = LINE.exec(line) ?? [];
    // A heading has no indent of its own; a list item keeps its nesting.
    const keep = kind === "heading" ? "" : indent;
    const out = off
      ? indent + line.slice(whole.length)
      : keep + PREFIX[kind] + line.slice(whole.length);
    deltas.push(out.length - line.length);
    return out;
  });
  const total = deltas.reduce((a, b) => a + b, 0);
  return {
    value: value.slice(0, from) + next.join("\n") + value.slice(to),
    start: Math.max(from, start + deltas[0]!),
    end: Math.max(from, end + total),
  };
}

const ITEM = /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\](?:\s+|$))?/;

/**
 * Enter in a list item: the next item, numbered and a task if this one is; Enter on an empty item
 * ends the list instead. Null outside a list, or with text selected: Enter does what it always does.
 */
export function continueList({ value, start, end }: TextSel): TextSel | null {
  if (start !== end) return null;
  const from = lineStart(value, start);
  const to = lineEnd(value, start);
  const line = value.slice(from, to);
  const m = ITEM.exec(line);
  if (!m || start - from < m[0].length) return null;
  const [marker, indent = "", bullet = "-", gap = " ", box] = m;
  if (!line.slice(marker.length).trim())
    return { value: value.slice(0, from) + value.slice(to), start: from, end: from };
  const n = Number.parseInt(bullet, 10);
  const next = Number.isNaN(n) ? bullet : `${n + 1}${bullet.slice(-1)}`;
  const insert = `\n${indent}${next}${gap}${box ? "[ ] " : ""}`;
  const at = start + insert.length;
  return { value: value.slice(0, start) + insert + value.slice(start), start: at, end: at };
}
