import { useEffect } from "react";

import { POLL_MS } from "@/web/lib/queries";
import { session } from "@/web/lib/session";
import { outbox } from "@/web/lib/storage";

/**
 * Sends what was left from last time, again the moment the connection returns, and on the poll
 * whatever the outbox still holds (the reads poll themselves, lib/queries.ts).
 */
export function useBackgroundSync() {
  useEffect(() => {
    const retry = () => void session.sync();
    const tick = () => {
      if (!document.hidden && outbox.all().length) retry();
    };
    retry();
    const id = setInterval(tick, POLL_MS);
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
}
