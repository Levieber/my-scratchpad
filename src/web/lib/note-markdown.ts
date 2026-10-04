// A note body read for the Read view: TanStack Markdown's document, with each task's checkbox
// numbered as `progress` counts tasks.
// The renderer gives no source positions, so the Nth rendered box is mapped to the Nth task line
// (shared/checklist.ts); when the two readings disagree, the boxes stay read-only.
import type { BlockNode, InlineNode, MarkdownDocument } from "@tanstack/markdown";
import { parseMarkdown } from "@tanstack/markdown/parser";

import { tasks } from "@/shared/checklist";
import { autolinks } from "@/web/lib/autolinks";

/** The element the document asks for in place of a task's checkbox. */
export const TASK_TAG = "pad-task";

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
  const document = parseMarkdown(body, { extensions: [autolinks] });
  const rendered: boolean[] = [];
  numberTasks(document.children, rendered);
  const source = tasks(body);
  const editable =
    rendered.length === source.length && rendered.every((done, i) => done === source[i]!.done);
  return { document, editable };
}
