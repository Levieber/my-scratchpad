import { lazy, Suspense, useEffect, useState } from "react";

import { Editor } from "@/web/components/editor/editor";
import { Sidebar } from "@/web/components/notes/sidebar";
import { Splitter } from "@/web/components/shell/splitter";
import { useAddress } from "@/web/hooks/address.hook";
import { useBackgroundSync } from "@/web/hooks/background-sync.hook";
import { useEditor } from "@/web/hooks/editor.hook";
import { usePage } from "@/web/hooks/route.hook";
import { useShortcuts } from "@/web/hooks/shortcuts.hook";
import { storedWidth, storeWidth } from "@/web/lib/storage";
import { cn } from "@/web/lib/utils";

// Most visits never open Settings: a chunk of its own, loaded when opened, wherever the
// bundler splits (Bun.build with `splitting`). Bun.serve's HTML import doesn't split yet, so the
// server still sends it in the one chunk (docs/architecture.md, "State in the PWA").
const Settings = lazy(() =>
  import("@/web/components/settings/settings").then((m) => ({ default: m.Settings })),
);

/** The page's frame: Settings, or the notes (list | resize handle | editor). */
export function Shell() {
  useShortcuts();
  useBackgroundSync();
  useAddress();
  const page = usePage();
  const { open } = useEditor();
  const [width, setWidth] = useState(storedWidth);
  const [listHidden, setListHidden] = useState(false);
  useEffect(() => storeWidth(width), [width]);

  const notesShown = page === "notes";
  return (
    // No note open: the list is the whole page. A note open: list | resize handle | editor on a
    // wide screen, the editor alone on a phone. One row, the screen's height: what is taller
    // scrolls inside its own area, never the page, so there is one scrollbar.
    <div
      className={cn(
        "grid h-dvh grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]",
        notesShown && open && !listHidden && "wide:grid-cols-[var(--sidebar)_auto_minmax(0,1fr)]",
      )}
      style={{ "--sidebar": `${width}px` } as React.CSSProperties}
    >
      {page === "settings" && (
        <Suspense>
          <Settings />
        </Suspense>
      )}
      {notesShown && (
        <>
          <Sidebar layout={open ? (listHidden ? "hidden" : "column") : "page"} />
          {open && !listHidden && <Splitter width={width} onChange={setWidth} />}
          {open && (
            <Editor listHidden={listHidden} onToggleList={() => setListHidden(!listHidden)} />
          )}
        </>
      )}
    </div>
  );
}
