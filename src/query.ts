/**
 * The search box's small language, shared by the server (which runs it) and the PWA (which edits
 * it when a chip is clicked): `kind:<kind>`, `author:<who>` and `#<tag>` narrow the results, every
 * other word is full-text search. A kind for a use case isn't needed: `kind:reference #launch`
 * finds launch checklists. `author:` takes `human`, `agent` (anyone who isn't the human) or an
 * author's name, e.g. `author:claude-code`.
 */
export type ParsedQuery = { text: string; kind?: string; author?: string; tags: string[] };

const tokens = (q: string) => q.split(/\s+/).filter(Boolean);

export function parseQuery(q: string): ParsedQuery {
  const words: string[] = [];
  const tags: string[] = [];
  let kind: string | undefined;
  let author: string | undefined;
  for (const token of tokens(q)) {
    const lower = token.toLowerCase();
    // A bare `#` or `kind:` is a half-typed operator, not a search word.
    if (lower.startsWith("kind:")) kind = lower.slice(5) || kind;
    else if (lower.startsWith("author:")) author = lower.slice(7) || author;
    else if (token.startsWith("#")) {
      if (token.length > 1) tags.push(lower.slice(1));
    } else words.push(token);
  }
  return { text: words.join(" "), ...(kind && { kind }), ...(author && { author }), tags };
}

export const hasToken = (q: string, token: string) =>
  tokens(q).some((t) => t.toLowerCase() === token.toLowerCase());

export function toggleToken(q: string, token: string): string {
  const rest = tokens(q).filter((t) => t.toLowerCase() !== token.toLowerCase());
  return (hasToken(q, token) ? rest : [...rest, token]).join(" ");
}

/** The value of an operator such as `kind` in `q`, or "" when it isn't there. */
export const operatorValue = (q: string, name: "kind" | "author") => parseQuery(q)[name] ?? "";

/**
 * Sets `name:value` in `q`, replacing any earlier one; an empty value clears it. Unlike a tag,
 * an operator has one value, so its chips behave like a radio group.
 */
export function setOperator(q: string, name: "kind" | "author", value: string): string {
  const prefix = `${name}:`;
  const rest = tokens(q).filter((t) => !t.toLowerCase().startsWith(prefix));
  return (value ? [...rest, prefix + value] : rest).join(" ");
}
