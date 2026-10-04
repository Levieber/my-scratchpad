// Addresses written as they are: `<https://…>` (CommonMark's autolink) and a bare `https://…`
// (GFM's), which TanStack Markdown leaves as text. Only http(s), so nothing executable is linked.
import type { MarkdownExtension } from "@tanstack/markdown";

// Sticky (`y`): matched where the parser stands, never by scanning the rest of the line.
const ANGLED = /<(https?:\/\/[^\s<>]+)>/y;
const BARE = /https?:\/\/[^\s<]+/y;
// What usually ends the sentence around an address rather than the address itself.
const TRAILING = /[.,:;!?'")\]*_~]+$/;

export const autolinks: MarkdownExtension = {
  name: "pad-autolinks",
  inlineParser: {
    markers: "<h",
    parse({ source, index, inLink }) {
      if (inLink) return undefined;
      ANGLED.lastIndex = index;
      const angled = ANGLED.exec(source);
      if (angled) return link(angled[1]!, angled[0].length);
      // Mid-word ("xhttps://") isn't an address.
      if (index > 0 && /\w/.test(source[index - 1]!)) return undefined;
      BARE.lastIndex = index;
      const bare = BARE.exec(source)?.[0].replace(TRAILING, "");
      return bare && /^https?:\/\/./.test(bare) ? link(bare, bare.length) : undefined;
    },
  },
};

const link = (href: string, length: number) => ({
  node: { type: "link" as const, href, children: [{ type: "text" as const, value: href }] },
  length,
});
