// A view embedded in a note: a fenced block whose info string is `pad-view`, holding `key: value`
// lines. Pad's markdown extension (shared/markdown.ts): anywhere it isn't understood it is a code
// block, so it reads as the text it is.
//
//   ```pad-view
//   query: #todo kind:note
//   layout: grid
//   limit: 10
//   ```
//
// Versioned on the fence (`pad-view` is version 1, `pad-view v2` the next): a reader shows a
// version it doesn't know as text. Keys it doesn't know are left out, so a version only grows.

export const EMBED_LANG = "pad-view";

/** The newest version of the block this code reads. */
export const EMBED_VERSION = 1;

/** The most notes an embedded view shows, and how many when it doesn't say. */
export const EMBED_LIMITS = { most: 50, default: 10 } as const;

export type Embed = {
  /** A search, operators included (shared/query.ts), or… */
  query?: string;
  /** …a saved view by name, its search and layout. */
  view?: string;
  layout?: string;
  limit: number;
};

/**
 * The block's version, from what follows `pad-view` on its fence (`v2`); 1 when nothing does,
 * and NaN for anything else, which no reader knows.
 */
export const embedVersion = (meta: string | undefined) => {
  const v = meta?.trim();
  if (!v) return 1;
  const m = /^v(\d+)$/.exec(v);
  return m ? Number(m[1]) : Number.NaN;
};

/** What a `pad-view` block of a version this code reads asks for; null when it can't be shown. */
export function readEmbed(code: string, meta?: string): Embed | null {
  if (embedVersion(meta) > EMBED_VERSION || Number.isNaN(embedVersion(meta))) return null;
  const fields = new Map<string, string>();
  for (const line of code.split("\n")) {
    const m = /^\s*([a-z]+)\s*:\s*(.*?)\s*$/i.exec(line);
    if (m) fields.set(m[1]!.toLowerCase(), m[2]!);
  }
  const query = fields.get("query") || undefined;
  const view = fields.get("view") || undefined;
  if (!query && !view) return null;
  const limit = Number(fields.get("limit"));
  return {
    ...(query && { query }),
    ...(view && { view }),
    ...(fields.get("layout") && { layout: fields.get("layout") }),
    limit:
      Number.isInteger(limit) && limit > 0
        ? Math.min(limit, EMBED_LIMITS.most)
        : EMBED_LIMITS.default,
  };
}
