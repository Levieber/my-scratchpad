import { createRef } from "react";
import { flushSync } from "react-dom";

import { session } from "@/web/lib/session";

// The two fields shortcuts and buttons move focus to. One app per page, so one of each.
export const searchRef = createRef<HTMLInputElement>();
export const bodyRef = createRef<HTMLTextAreaElement>();

export function focusSearch() {
  searchRef.current?.focus();
  searchRef.current?.select();
}

/**
 * A new note, holding `body`, under the page `parent` if one is given, with the cursor at the end
 * of its body: rendered first, so the body is there to focus.
 */
export function newNote(body = "", parent: string | null = null) {
  flushSync(() => session.create(body, parent));
  const field = bodyRef.current;
  field?.focus();
  field?.setSelectionRange(body.length, body.length);
}
