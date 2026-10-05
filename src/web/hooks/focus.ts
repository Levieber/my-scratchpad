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

/** A new note, with the cursor in its body: rendered first, so the body is there to focus. */
export function newNote() {
  flushSync(() => session.create());
  bodyRef.current?.focus();
}

/** A new note under the page `parent`, the same way. */
export function newSubpage(parent: string) {
  flushSync(() => session.create("", parent));
  bodyRef.current?.focus();
}
