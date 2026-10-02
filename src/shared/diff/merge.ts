// Combining two edits of the same text, for the PWA's offline saves.
import { diffLines, lines } from "./lines";

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
