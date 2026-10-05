// The one place a note body is rendered: the renderer (TanStack Markdown, pinned) stays behind this
// component, in a chunk of its own loaded with the Read view, so it can be swapped. Raw HTML in a
// body is shown as text and `javascript:` links are dropped by the renderer; the PWA's CSP
// (server/pages.ts) is the second line.
import { Markdown } from "@tanstack/markdown/react";
import { type ReactNode, useMemo } from "react";

import type { Embed } from "@/shared/embeds";
import {
  elements,
  EmbedRenderer,
  LinkActions,
  TaskActions,
} from "@/web/components/editor/markdown-elements";
import { highlight } from "@/web/lib/highlight";
import { readNote } from "@/web/lib/note-markdown";

export function NoteMarkdown({
  body,
  onToggle,
  onOpenLink,
  renderEmbed,
}: {
  body: string;
  /** Ticks or unticks the `n`th task; absent, the boxes are read-only. */
  onToggle?: (n: number) => void;
  /** Follows a link to another note; absent, links are only shown. */
  onOpenLink?: (target: string) => void;
  /** Shows an embedded view live; absent, it is shown as the block it is written as. */
  renderEmbed?: (embed: Embed) => ReactNode;
}) {
  const { document, editable } = useMemo(() => readNote(body), [body]);
  const actions = useMemo(
    () => (editable && onToggle ? { toggle: onToggle } : null),
    [editable, onToggle],
  );
  return (
    <TaskActions.Provider value={actions}>
      <LinkActions.Provider value={onOpenLink ?? null}>
        <EmbedRenderer.Provider value={renderEmbed ?? null}>
          <Markdown components={elements} highlighter={highlight}>
            {document}
          </Markdown>
        </EmbedRenderer.Provider>
      </LinkActions.Provider>
    </TaskActions.Provider>
  );
}
