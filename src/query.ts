/**
 * The search box's small language, shared by the server (which runs it) and the PWA (which edits
 * it when a tag chip is clicked): `kind:<kind>` and `#<tag>` narrow the results, every other word
 * is full-text search. A kind for a use case isn't needed: `kind:reference #launch` finds launch
 * checklists.
 */
export type ParsedQuery = { text: string; kind?: string; tags: string[] };

const tokens = (q: string) => q.split(/\s+/).filter(Boolean);

export function parseQuery(q: string): ParsedQuery {
  const words: string[] = [];
  const tags: string[] = [];
  let kind: string | undefined;
  for (const token of tokens(q)) {
    const lower = token.toLowerCase();
    // A bare `#` or `kind:` is a half-typed operator, not a search word.
    if (lower.startsWith("kind:")) kind = lower.slice(5) || kind;
    else if (token.startsWith("#")) {
      if (token.length > 1) tags.push(lower.slice(1));
    } else words.push(token);
  }
  return { text: words.join(" "), ...(kind && { kind }), tags };
}

export const hasToken = (q: string, token: string) =>
  tokens(q).some((t) => t.toLowerCase() === token.toLowerCase());

export function toggleToken(q: string, token: string): string {
  const rest = tokens(q).filter((t) => t.toLowerCase() !== token.toLowerCase());
  return (hasToken(q, token) ? rest : [...rest, token]).join(" ");
}
