// Line diffs and three-way merges of note bodies. Pure, so the server (revision diffs) and the
// PWA (merging edits made offline) share one implementation.

export type Op = { type: "equal" | "insert" | "delete"; line: string };

/** A body as lines. The empty body has none, so creating a note reads as lines added, not changed. */
export const lines = (text: string): string[] => (text === "" ? [] : text.split("\n"));

// Past this many edits Myers' trace (quadratic in the edit count) costs more than it's worth; two
// bodies that different are shown as one replacement.
const MAX_EDITS = 1000;

/** The shortest line-by-line edit turning `a` into `b` (Myers' O(ND) algorithm). */
export function diffLines(a: string[], b: string[]): Op[] {
  // Trimming the common ends first makes the usual edits (an append, one changed paragraph) linear.
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (
    suf < a.length - pre &&
    suf < b.length - pre &&
    a[a.length - 1 - suf] === b[b.length - 1 - suf]
  )
    suf++;
  const equal = (line: string): Op => ({ type: "equal", line });
  return [
    ...a.slice(0, pre).map(equal),
    ...myers(a.slice(pre, a.length - suf), b.slice(pre, b.length - suf)),
    ...a.slice(a.length - suf).map(equal),
  ];
}

function myers(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const replace = (): Op[] => [
    ...a.map((line): Op => ({ type: "delete", line })),
    ...b.map((line): Op => ({ type: "insert", line })),
  ];
  if (!n || !m) return replace();

  // trace[d][k + d]: the furthest x reached on diagonal k (= x - y) with d edits.
  const trace: Int32Array[] = [];
  for (let d = 0; d <= Math.min(n + m, MAX_EDITS); d++) {
    const prev = trace[d - 1];
    const v = new Int32Array(2 * d + 1);
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (!prev) x = 0;
      else if (k === -d || (k !== d && prev[k - 1 + d - 1]! < prev[k + 1 + d - 1]!))
        x = prev[k + 1 + d - 1]!; // down: insert b[y]
      else x = prev[k - 1 + d - 1]! + 1; // right: delete a[x]
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[k + d] = x;
      if (x >= n && y >= m) {
        trace.push(v);
        return backtrack(trace, a, b);
      }
    }
    trace.push(v);
  }
  return replace();
}

function backtrack(trace: Int32Array[], a: string[], b: string[]): Op[] {
  const ops: Op[] = [];
  let x = a.length;
  let y = b.length;
  for (let d = trace.length - 1; d > 0; d--) {
    const prev = trace[d - 1]!;
    const k = x - y;
    const down = k === -d || (k !== d && prev[k - 1 + d - 1]! < prev[k + 1 + d - 1]!);
    const pk = down ? k + 1 : k - 1;
    const px = prev[pk + d - 1]!;
    const py = px - pk;
    while (x > px && y > py) {
      x--;
      y--;
      ops.push({ type: "equal", line: a[x]! });
    }
    ops.push(down ? { type: "insert", line: b[py]! } : { type: "delete", line: a[px]! });
    x = px;
    y = py;
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    ops.push({ type: "equal", line: a[x]! });
  }
  return ops.reverse();
}

/** Lines added and removed going from `a` to `b`. */
export function diffStats(a: string, b: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const op of diffLines(lines(a), lines(b))) {
    if (op.type === "insert") added++;
    else if (op.type === "delete") removed++;
  }
  return { added, removed };
}

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

/** Replace base lines [start, end) with `lines`. */
type Hunk = { start: number; end: number; lines: string[] };

function hunks(base: string[], other: string[]): Hunk[] {
  const found: Hunk[] = [];
  let i = 0;
  let open: Hunk | null = null;
  for (const op of diffLines(base, other)) {
    if (op.type === "equal") {
      open = null;
      i++;
      continue;
    }
    if (!open) found.push((open = { start: i, end: i, lines: [] }));
    if (op.type === "delete") open.end = ++i;
    else open.lines.push(op.line);
  }
  return found;
}

/** `base[start, end)` with a side's hunks inside that range applied. */
function applyWithin(base: string[], start: number, end: number, side: Hunk[]): string[] {
  const out: string[] = [];
  let pos = start;
  for (const h of side) {
    out.push(...base.slice(pos, h.start), ...h.lines);
    pos = h.end;
  }
  out.push(...base.slice(pos, end));
  return out;
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((l, i) => l === b[i]);

export const CONFLICT_MARKERS = {
  mine: "<<<<<<< your edit",
  split: "=======",
  theirs: ">>>>>>> saved elsewhere",
} as const;

/**
 * Combines two edits of the same `base`: where only one side changed a region it wins, where both
 * made the same change it is kept once. Both sides adding lines at the same spot (an agent and a
 * person appending to one log) keeps both, theirs first, since nothing was removed. Any other
 * overlap keeps both versions between git-style markers for a person to resolve.
 */
export function merge3(
  base: string,
  mine: string,
  theirs: string,
): { text: string; conflict: boolean } {
  if (mine === theirs || theirs === base) return { text: mine, conflict: false };
  if (mine === base) return { text: theirs, conflict: false };

  const b = lines(base);
  const tagged = [
    ...hunks(b, lines(mine)).map((h) => ({ ...h, mine: true })),
    ...hunks(b, lines(theirs)).map((h) => ({ ...h, mine: false })),
  ].sort((x, y) => x.start - y.start || x.end - y.end);

  const out: string[] = [];
  let conflict = false;
  let pos = 0;
  for (let i = 0; i < tagged.length;) {
    // A group is a run of hunks whose base ranges overlap, or insertions at one spot.
    const start = tagged[i]!.start;
    let end = tagged[i]!.end;
    const group = [tagged[i++]!];
    while (
      i < tagged.length &&
      (tagged[i]!.start < end || (tagged[i]!.start === start && start === end))
    ) {
      end = Math.max(end, tagged[i]!.end);
      group.push(tagged[i++]!);
    }
    out.push(...b.slice(pos, start));
    pos = end;

    const region = b.slice(start, end);
    const m = applyWithin(
      b,
      start,
      end,
      group.filter((h) => h.mine),
    );
    const t = applyWithin(
      b,
      start,
      end,
      group.filter((h) => !h.mine),
    );
    if (same(m, region) || same(m, t)) out.push(...t);
    else if (same(t, region)) out.push(...m);
    else if (start === end) out.push(...t, ...m);
    else {
      conflict = true;
      out.push(CONFLICT_MARKERS.mine, ...m, CONFLICT_MARKERS.split, ...t, CONFLICT_MARKERS.theirs);
    }
  }
  out.push(...b.slice(pos));
  return { text: out.join("\n"), conflict };
}
