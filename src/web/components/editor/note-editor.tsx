// The body's editor, whatever its mode: the editor form and the outbox talk only to this, so a
// richer editor later is one more mode here rather than a change to them.
import { lazy, Suspense, useCallback } from "react";

import { WriteView } from "@/web/components/editor/write-view";
import { openLink } from "@/web/hooks/pages.hook";
import { toggleTask } from "@/web/lib/checklist-edit";
import type { EditorMode } from "@/web/lib/editor-session";

export type NoteEditorProps = {
  /** The body, markdown byte for byte: no mode may rewrite what it doesn't change. */
  value: string;
  onChange: (body: string) => void;
  /**
   * Changes when the body was replaced from outside (the server, a merge, a restore): a mode that
   * keeps its own copy of the body resets from `value` then. Read and Write render `value`, so
   * need not.
   */
  external: number;
  mode: EditorMode;
  readOnly?: boolean;
};

// The renderer is only needed once a note is read: its own chunk wherever the bundler splits.
const NoteMarkdown = lazy(() =>
  import("@/web/components/editor/note-markdown").then((m) => ({ default: m.NoteMarkdown })),
);

const followLink = (target: string) => void openLink(target);

function ReadView({ value, onChange, readOnly }: NoteEditorProps) {
  const toggle = useCallback(
    (n: number) => {
      const next = toggleTask(value, n);
      if (next !== null) onChange(next);
    },
    [value, onChange],
  );
  return (
    <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-input px-3.5 py-2.5 text-base/[1.6] break-words">
      {value.trim() ? (
        <Suspense fallback={<p className="text-xs text-muted-foreground">Loading…</p>}>
          <NoteMarkdown
            body={value}
            onToggle={readOnly ? undefined : toggle}
            onOpenLink={followLink}
          />
        </Suspense>
      ) : (
        <p className="text-muted-foreground">Nothing here yet: open Write to start.</p>
      )}
    </div>
  );
}

export function NoteEditor(props: NoteEditorProps) {
  return props.mode === "read" ? <ReadView {...props} /> : <WriteView {...props} />;
}
