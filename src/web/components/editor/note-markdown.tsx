// The one place a note body is rendered: the renderer (TanStack Markdown, pinned) stays behind this
// component, in a chunk of its own loaded with the Read view, so it can be swapped. Raw HTML in a
// body is shown as text and `javascript:` links are dropped by the renderer; the PWA's CSP
// (server/pages.ts) is the second line.
import { Markdown } from "@tanstack/markdown/react";
import { useMemo } from "react";

import { elements, TaskActions } from "@/web/components/editor/markdown-elements";
import { readNote } from "@/web/lib/note-markdown";

export function NoteMarkdown({
  body,
  onToggle,
}: {
  body: string;
  /** Ticks or unticks the `n`th task; absent, the boxes are read-only. */
  onToggle?: (n: number) => void;
}) {
  const { document, editable } = useMemo(() => readNote(body), [body]);
  const actions = useMemo(
    () => (editable && onToggle ? { toggle: onToggle } : null),
    [editable, onToggle],
  );
  return (
    <TaskActions.Provider value={actions}>
      <Markdown components={elements}>{document}</Markdown>
    </TaskActions.Provider>
  );
}
