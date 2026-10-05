// `[[Note title]]`, `[[id]]` and `[[target|text]]` (shared/links.ts) as the Read view shows them:
// an element that opens the note, in place of the text. Read where the parser stands, so code
// spans, already read by then, keep the brackets as text.
import type { MarkdownExtension } from "@tanstack/markdown";

import { NOTE_LINK } from "@/shared/links";

/** The element the document asks for in place of a link to a note. */
export const NOTE_LINK_TAG = "pad-note-link";

const AT = new RegExp(NOTE_LINK.source, "y");

export const noteLinks: MarkdownExtension = {
  name: "pad-note-links",
  inlineParser: {
    markers: "[",
    parse({ source, index, inLink }) {
      if (inLink) return undefined;
      AT.lastIndex = index;
      const m = AT.exec(source);
      const target = m?.[1]!.trim();
      if (!m || !target) return undefined;
      return {
        node: {
          type: "inlineComponent" as const,
          name: "noteLink",
          tagName: NOTE_LINK_TAG,
          attributes: {},
          properties: { "data-target": target },
          children: [{ type: "text" as const, value: (m[2] ?? m[1]!).trim() }],
        },
        length: m[0].length,
      };
    },
  },
};
