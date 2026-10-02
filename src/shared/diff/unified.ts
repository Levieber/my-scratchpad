// A difference as the text `git diff` and `patch` use.
import { diffLines, lines } from "./lines";

/**
 * `a` → `b` as a unified diff (the format of `git diff` and `patch`), or "" when they are equal.
 * `labels` name the two sides in the `---`/`+++` header.
 */
export function unifiedDiff(
  a: string,
  b: string,
  labels = ["before", "after"],
  context = 3,
): string {
  const ops = diffLines(lines(a), lines(b));
  // Each op's line number on both sides, so a hunk's header can be read off its first op.
  const at: { a: number; b: number }[] = [];
  let ai = 0;
  let bi = 0;
  for (const op of ops) {
    at.push({ a: ai, b: bi });
    if (op.type !== "insert") ai++;
    if (op.type !== "delete") bi++;
  }

  // Changed ops widened by the context, merged where the context of two changes overlaps.
  const ranges: [number, number][] = [];
  ops.forEach((op, i) => {
    if (op.type === "equal") return;
    const start = Math.max(0, i - context);
    const end = Math.min(ops.length, i + context + 1);
    const last = ranges.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else ranges.push([start, end]);
  });
  if (!ranges.length) return "";

  const out = [`--- ${labels[0]}`, `+++ ${labels[1]}`];
  for (const [start, end] of ranges) {
    const slice = ops.slice(start, end);
    const aCount = slice.filter((op) => op.type !== "insert").length;
    const bCount = slice.filter((op) => op.type !== "delete").length;
    // An empty side is numbered by the line before it, as in GNU diff.
    const aStart = aCount ? at[start]!.a + 1 : at[start]!.a;
    const bStart = bCount ? at[start]!.b + 1 : at[start]!.b;
    out.push(`@@ -${aStart},${aCount} +${bStart},${bCount} @@`);
    for (const op of slice)
      out.push((op.type === "insert" ? "+" : op.type === "delete" ? "-" : " ") + op.line);
  }
  return out.join("\n") + "\n";
}
