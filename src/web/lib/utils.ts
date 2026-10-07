// shadcn's class helper: joins class names and lets a later Tailwind class override an earlier one.
import { createCn } from "cn/config";

// The text sizes index.css adds to Tailwind's scale. Unregistered, `text-caption` reads as a color
// and silently drops `text-muted-foreground` beside it (or is dropped by it). The configurable
// build costs 5.5 KB gzipped over the default (2026-10-06, ~2% of the main chunk); renaming the
// sizes to t-shirt names cn already knows (`text-md` for 13 px) would read wrong.
export const cn = createCn({
  extend: { classGroups: { "font-size": [{ text: ["title", "caption", "label"] }] } },
});
