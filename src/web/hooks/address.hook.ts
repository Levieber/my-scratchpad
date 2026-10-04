import { useEffect, useState } from "react";

import { openNote, useEditor } from "@/web/hooks/editor.hook";
import { useLayout } from "@/web/hooks/layout.hook";
import { currentRoute, showInAddress } from "@/web/hooks/route.hook";
import { useSearch } from "@/web/hooks/search.hook";

/**
 * Keeps the address saying what the notes show (lib/routes.ts): the search once typing pauses,
 * the layout, and the open note; and opens the note the address named when the app started.
 */
export function useAddress() {
  const { asked } = useSearch();
  const { layout, unknown } = useLayout();
  const { open, current } = useEditor();
  // Until the note the address names has loaded (or failed to), the address keeps naming it.
  const [opening, setOpening] = useState(() => currentRoute().note);
  useEffect(() => {
    const id = currentRoute().note;
    if (id) void openNote(id).finally(() => setOpening(null));
  }, []);
  const note = opening ?? (open ? (current?.id ?? null) : null);
  useEffect(
    () => showInAddress({ q: asked, layout: unknown ?? layout, note }),
    [asked, layout, unknown, note],
  );
}
