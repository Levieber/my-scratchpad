import { lazy, Suspense } from "react";

import { EditorToolbar } from "@/web/components/editor/editor-toolbar";
import { Input } from "@/web/components/ui/input";
import { Textarea } from "@/web/components/ui/textarea";
import { useEditor, useLiveOpenNote } from "@/web/hooks/editor.hook";
import { bodyRef } from "@/web/hooks/focus";
import { saveLabel } from "@/web/lib/draft";
import { ago } from "@/web/lib/listing";
import { session } from "@/web/lib/session";

// Most visits never open a note's history: a chunk of its own, loaded when opened, wherever the
// bundler splits (Bun.build with `splitting`). Bun.serve's HTML import doesn't split yet, so the
// server still sends it in the one chunk (docs/architecture.md, "State in the PWA").
const History = lazy(() =>
  import("@/web/components/editor/history").then((m) => ({ default: m.History })),
);

/** The right column: the open note's form, or its history. */
export function Editor({
  listHidden,
  onToggleList,
}: {
  listHidden: boolean;
  onToggleList: () => void;
}) {
  const { draft, current, showHistory, saveState, saveError } = useEditor();
  useLiveOpenNote();
  return (
    <main className="flex min-h-0 flex-col gap-2.5 px-5 py-3.5 max-wide:px-4 max-wide:py-3">
      <EditorToolbar listHidden={listHidden} onToggleList={onToggleList} />
      {showHistory && current ? (
        <Suspense
          fallback={<p className="flex-1 text-xs text-muted-foreground">Loading history…</p>}
        >
          <History key={current.id} noteId={current.id} onRestore={session.restore} />
        </Suspense>
      ) : (
        <>
          <Input
            aria-label="Tags"
            placeholder="tags, comma separated"
            value={draft.tags}
            onChange={(e) => session.edit({ tags: e.target.value })}
          />
          <Textarea
            ref={bodyRef}
            className="min-h-0 flex-1 resize-none p-3.5 font-mono text-base/[1.6] field-sizing-fixed"
            aria-label="Body"
            placeholder="Write anything. Markdown welcome."
            value={draft.body}
            onChange={(e) => session.edit({ body: e.target.value })}
          />
        </>
      )}
      <footer className="flex justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {current ? `by ${current.author} · created ${ago(current.created_at)}` : "new note"}
        </span>
        {/* Announced, since it can say an edit is only on this device or conflicted. */}
        <output>{saveLabel(saveState, saveError)}</output>
      </footer>
    </main>
  );
}
