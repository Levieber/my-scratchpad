// What the app does with a failure no component words itself.
import { toast } from "sonner";

import { ApiError, Offline, Unauthorized } from "@/web/lib/api";
import { Store } from "@/web/lib/store";

/** The server asked for a token this browser doesn't have (or has wrong): the app asks for it. */
export const needsToken = new Store(false);

/**
 * Offline is already on screen (the footer), and a missing token opens the token dialog. The
 * API's refusals are the person's to act on (a pin over the limit, say), so they show; the same
 * one again replaces it rather than piling up. Anything else is a bug: logged.
 */
export function handle(e: unknown) {
  if (e instanceof Unauthorized) needsToken.set(true);
  else if (e instanceof ApiError) toast.error(e.message, { id: e.message });
  else if (!(e instanceof Offline)) console.error(e);
}

/** The API's refusal, worded for the person; anything else (offline, the token) goes to `handle`. */
export function refusal(e: unknown) {
  if (e instanceof ApiError) return e.message;
  handle(e);
  return "";
}
