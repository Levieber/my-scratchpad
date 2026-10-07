import { lazy, Suspense } from "react";

import { EditorToolbar } from "@/web/components/editor/editor-toolbar";
import { NoteEditor } from "@/web/components/editor/note-editor";
import { Breadcrumbs, LinkedFrom, Subpages } from "@/web/components/editor/page-links";
import { Input } from "@/web/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/web/components/ui/tabs";
import { useEditor, useLiveOpenNote } from "@/web/hooks/editor.hook";
import { saveLabel } from "@/web/lib/draft";
import type { EditorMode } from "@/web/lib/editor-session";
import { ago } from "@/web/lib/listing";
import { session } from "@/web/lib/session";

// Most visits never open a note's history: a chunk of its own, loaded when opened, wherever the
// bundler splits (Bun.build with `splitting`). Bun.serve's HTML import doesn't split yet, so the
// server still sends it in the one chunk (docs/architecture.md, "State in the PWA").
const History = lazy(() =>
  import("@/web/components/editor/history").then((m) => ({ default: m.History })),
);

const setBody = (body: string) => session.edit({ body });

/** The right column: the open note's form, or its history. */
export function Editor({
  listHidden,
  onToggleList,
}: {
  listHidden: boolean;
  onToggleList: () => void;
}) {
  const { draft, current, showHistory, saveState, saveError, mode, external } = useEditor();
  useLiveOpenNote();
  return (
    <main className="@container/editor flex min-h-0 flex-col gap-2.5 px-5 py-3.5 max-wide:px-4 max-wide:py-3">
      <Breadcrumbs note={current} />
      <EditorToolbar listHidden={listHidden} onToggleList={onToggleList} />
      {showHistory && current ? (
        <Suspense
          fallback={<p className="flex-1 text-xs text-muted-foreground">Loading history…</p>}
        >
          <History key={current.id} noteId={current.id} onRestore={session.restore} />
        </Suspense>
      ) : (
        // Base UI marks the orientation as data-orientation, not the data-horizontal shadcn's
        // Tabs reads to stack the list over the panel.
        <Tabs
          className="min-h-0 flex-1 flex-col gap-2.5"
          value={mode}
          onValueChange={(v: EditorMode) => session.setMode(v)}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="flex-[1_1_12rem]"
              aria-label="Tags"
              placeholder="tags, comma separated"
              value={draft.tags}
              onChange={(e) => session.edit({ tags: e.target.value })}
            />
            <TabsList>
              <TabsTrigger value="read">Read</TabsTrigger>
              <TabsTrigger value="write">Write</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value={mode} className="flex min-h-0 flex-col gap-1.5 rounded-md focus-ring">
            <NoteEditor mode={mode} value={draft.body} onChange={setBody} external={external} />
          </TabsContent>
        </Tabs>
      )}
      {/* A note the server hasn't seen yet has nothing under it, and nowhere to file under. */}
      {current && !showHistory && (
        <>
          <Subpages note={current} />
          <LinkedFrom note={current} />
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
