// A note body read for the Read view: TanStack Markdown's document, with each task's checkbox
// numbered as `progress` counts tasks.
// The renderer gives no source positions, so the Nth rendered box is mapped to the Nth task line
// (shared/checklist.ts); when the two readings disagree, the boxes stay read-only.
import type { BlockNode, InlineNode, MarkdownDocument } from "@tanstack/markdown";
import { parseMarkdown } from "@tanstack/markdown/parser";

import { tasks } from "@/shared/checklist";
import { EMBED_LANG, readEmbed } from "@/shared/embeds";
import { autolinks } from "@/web/lib/autolinks";
import { noteLinks } from "@/web/lib/note-links";

/** The element the document asks for in place of a task's checkbox. */
export const TASK_TAG = "pad-task";

/** The element the document asks for in place of a `pad-view` block it can show. */
export const EMBED_TAG = "pad-embed";

/**
 * Each `pad-view` block this app can show, as an element in its place; its source goes with it,
 * so where nothing shows views it is still the text it was. One it can't read stays code.
 */
function embedViews(blocks: BlockNode[]) {
  blocks.forEach((block, i) => {
    if (block.type === "code" && block.lang === EMBED_LANG) {
      const embed = readEmbed(block.value, block.meta);
      if (embed)
        blocks[i] = {
          type: "component",
          name: "embed",
          tagName: EMBED_TAG,
          attributes: {},
          properties: {
            "data-embed": JSON.stringify(embed),
            "data-source": block.value,
          },
          children: [],
        };
    } else if (block.type === "list") for (const item of block.items) embedViews(item.children);
    else if (block.type === "blockquote" || block.type === "callout" || block.type === "component")
      embedViews(block.children);
  });
}

export type ReadNote = {
  document: MarkdownDocument;
  /** Whether each rendered box is the task line it stands for, so a click may edit it. */
  editable: boolean;
};

/** What a reader sees of inline content: a task's text, to name its checkbox. */
const plain = (nodes: InlineNode[]): string =>
  nodes
    .map((n) =>
      "value" in n
        ? n.value
        : "children" in n
          ? plain(n.children)
          : n.type === "image"
            ? n.alt
            : "",
    )
    .join("");

/**
 * Numbers the task boxes in document order (an item, then what is nested in it, then the next
 * item), as the lines they come from are ordered.
 */
function numberTasks(blocks: BlockNode[], found: boolean[]) {
  for (const block of blocks) {
    if (block.type === "list")
      for (const item of block.items) {
        if (item.checked !== undefined) {
          const first = item.children[0];
          const box = {
            type: "inlineComponent" as const,
            name: "task",
            tagName: TASK_TAG,
            attributes: {},
            properties: {
              "data-index": String(found.length),
              "data-checked": String(item.checked),
              "aria-label": first?.type === "paragraph" ? plain(first.children).trim() : "",
            },
            children: [],
          };
          found.push(item.checked);
          item.checked = undefined;
          if (first?.type === "paragraph")
            first.children.unshift(box, { type: "text", value: " " });
          else item.children.unshift({ type: "paragraph", children: [box] });
        }
        numberTasks(item.children, found);
      }
    else if (block.type === "blockquote" || block.type === "callout" || block.type === "component")
      numberTasks(block.children, found);
  }
}

export function readNote(body: string): ReadNote {
  const document = parseMarkdown(body, { extensions: [autolinks, noteLinks] });
  const rendered: boolean[] = [];
  numberTasks(document.children, rendered);
  embedViews(document.children);
  const source = tasks(body);
  const editable =
    rendered.length === source.length && rendered.every((done, i) => done === source[i]!.done);
  return { document, editable };
}
