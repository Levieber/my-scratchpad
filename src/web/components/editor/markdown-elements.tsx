import type { MarkdownComponents } from "@tanstack/markdown/react";
import { type ComponentProps, createContext, createElement, type JSX, useContext } from "react";

import { Checkbox } from "@/web/components/ui/checkbox";
import { TASK_TAG } from "@/web/lib/note-markdown";

/** What the Read view lets a reader do to the note; null when its boxes can't be mapped to lines. */
export const TaskActions = createContext<{ toggle: (n: number) => void } | null>(null);

type TaskProps = { "data-index": string; "data-checked": string; "aria-label": string };

function TaskBox(props: TaskProps) {
  const actions = useContext(TaskActions);
  const n = Number(props["data-index"]);
  return (
    <Checkbox
      className="mr-1.5 inline-flex size-6 align-middle"
      aria-label={props["aria-label"] || `Item ${n + 1}`}
      checked={props["data-checked"] === "true"}
      disabled={!actions}
      onCheckedChange={() => actions?.toggle(n)}
    />
  );
}

// Addresses in a note are the note's author's; they open outside the app and learn nothing of it.
function Link({ href, children, ...props }: ComponentProps<"a">) {
  return (
    <a
      {...props}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-2"
    >
      {children}
    </a>
  );
}

// An image would load from wherever the body points (the CSP allows only this site): a link to it
// says what it is without fetching it.
function Image({ src, alt }: ComponentProps<"img">) {
  return <Link href={typeof src === "string" ? src : undefined}>{alt || "image"}</Link>;
}

/** The element the renderer asked for, with the app's styling in place of none. */
const styled =
  (tag: keyof JSX.IntrinsicElements, className: string) => (props: Record<string, unknown>) =>
    createElement(tag, { ...props, className });

// Wide tables scroll on their own rather than pushing the page sideways.
function Table(props: ComponentProps<"table">) {
  return (
    <div className="my-2 overflow-x-auto">
      <table {...props} className="border-collapse text-sm" />
    </div>
  );
}

/** Each element the renderer emits, styled with the app's tokens; keys are tag names. */
export const elements: MarkdownComponents = {
  h1: styled("h1", "mt-5 mb-2 text-2xl font-bold first:mt-0"),
  h2: styled("h2", "mt-5 mb-2 text-xl font-bold first:mt-0"),
  h3: styled("h3", "mt-4 mb-1.5 text-lg font-semibold first:mt-0"),
  h4: styled("h4", "mt-4 mb-1.5 font-semibold first:mt-0"),
  h5: styled("h5", "mt-3 mb-1 font-semibold first:mt-0"),
  h6: styled("h6", "mt-3 mb-1 font-semibold text-muted-foreground first:mt-0"),
  p: styled("p", "my-2"),
  // In a bulleted list a task's box stands in for its bullet; a numbered one keeps its numbers.
  ul: styled(
    "ul",
    "my-2 list-disc pl-6 [&_ul]:my-0.5 [&>li:has(>[data-slot=checkbox])]:list-none [&>li:has(>p>[data-slot=checkbox])]:list-none",
  ),
  ol: styled("ol", "my-2 list-decimal pl-6 [&_ol]:my-0.5"),
  li: styled("li", "my-0.5"),
  blockquote: styled("blockquote", "my-2 border-l-4 border-border pl-3 text-muted-foreground"),
  // Highlighted tokens (lib/highlight.ts) in the palette, so they follow light and dark.
  pre: styled(
    "pre",
    "my-2 overflow-x-auto rounded-md bg-muted p-3 font-mono text-sm [&>code]:bg-transparent [&>code]:p-0 [&_.th-command]:text-primary [&_.th-comment]:text-muted-foreground [&_.th-comment]:italic [&_.th-deleted]:text-destructive [&_.th-function]:font-semibold [&_.th-heading]:font-semibold [&_.th-inserted]:text-success [&_.th-keyword]:text-primary [&_.th-literal]:text-destructive [&_.th-meta]:text-muted-foreground [&_.th-number]:text-destructive [&_.th-string]:text-success [&_.th-tag]:text-primary [&_.th-type]:font-semibold",
  ),
  code: styled("code", "rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]"),
  table: Table,
  th: styled("th", "border border-border bg-muted px-2 py-1 text-left font-semibold"),
  td: styled("td", "border border-border px-2 py-1"),
  hr: styled("hr", "my-4 border-border"),
  a: Link,
  img: Image,
  [TASK_TAG]: TaskBox,
};
