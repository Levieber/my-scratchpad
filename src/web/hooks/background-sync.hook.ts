import { useEffect } from "react";

import { session } from "@/web/lib/session";

/** Sends what was left from last time, and sends again the moment the connection returns. */
export function useBackgroundSync() {
  useEffect(() => {
    const retry = () => void session.sync();
    retry();
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, []);
}
