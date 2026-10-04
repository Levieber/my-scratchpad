import { useEffect } from "react";

import { focusSearch, newNote } from "@/web/hooks/focus";
import { session } from "@/web/lib/session";

/** Keyboard shortcuts, the share target (/?text=...), and keeping an edit when the tab closes. */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A field that used the key itself (the body: Ctrl+K makes a link there) has the last word.
      if (e.defaultPrevented) return;
      // Ctrl+K types nothing, so unlike "/" it works from inside a field too. Taken from the
      // browser, whose own Ctrl+K searches the web.
      if (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey) && !e.altKey) {
        e.preventDefault();
        focusSearch();
      } else if (e.key.toLowerCase() === "n" && e.ctrlKey && e.altKey) {
        e.preventDefault();
        newNote();
      } else if (e.key === "s" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void session.save();
      }
    };
    // Only the outbox write: a request started now may never finish, and the next visit sends it.
    const onUnload = () => session.commit();
    document.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onUnload);

    const p = new URLSearchParams(location.search);
    const shared = [p.get("title"), p.get("text"), p.get("url")].filter(Boolean).join("\n");
    if (shared) {
      history.replaceState(null, "", "/");
      void session.share(shared);
    }
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, []);
}
