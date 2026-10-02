// The line-by-line difference between two texts (Myers' algorithm), the base of the other two.
// Pure, like everything in diff/: the server (revision diffs) and the PWA (merging edits made
// offline) share one implementation.

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
