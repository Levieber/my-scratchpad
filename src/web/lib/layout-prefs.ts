// The layout this device shows a search in when no view chose one: a per-device preference, like
// the editor's mode. Storage failing (private mode) means the default.
import { DEFAULT_LAYOUT, isLayout, type Layout } from "@/shared/layouts";
import { Store } from "@/web/lib/store";

const KEY = "pad-layout";

const stored = (): Layout => {
  try {
    const v = localStorage.getItem(KEY);
    return isLayout(v) ? v : DEFAULT_LAYOUT;
  } catch {
    return DEFAULT_LAYOUT;
  }
};

export const preferredLayout = new Store<Layout>(stored());
preferredLayout.subscribe(() => {
  try {
    localStorage.setItem(KEY, preferredLayout.get());
  } catch {}
});
