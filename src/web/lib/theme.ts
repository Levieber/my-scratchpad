// The theme this device chose: System (the device's own light or dark), Light or Dark. A per-device
// convenience like the editor's font: storage failing (private mode) means System.
import { Store } from "@/web/lib/store";

const KEY = "pad-theme";

export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

const stored = (): Theme => {
  try {
    const v = localStorage.getItem(KEY);
    return THEMES.find((t) => t === v) ?? "system";
  } catch {
    return "system";
  }
};

export const theme = new Store<Theme>(stored());

/**
 * Puts the theme on the page: `data-theme` on <html>, which the palette and Tailwind's `dark:`
 * follow (index.css), absent for System; and the browser's own bar, whose two theme-color metas
 * (index.html) answer the device's setting, set to the chosen palette's background.
 */
function apply(chosen: Theme) {
  const root = document.documentElement;
  if (chosen === "system") delete root.dataset.theme;
  else root.dataset.theme = chosen;
  const background = getComputedStyle(root).getPropertyValue("--background").trim();
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.dataset.device ??= meta.content;
    meta.content = chosen === "system" ? meta.dataset.device : background;
  }
}

/**
 * Applies the stored theme and follows later choices. Called before the first render (main.tsx):
 * the CSP allows no inline script in the page's head, so this is as early as it can be.
 */
export function startTheme() {
  apply(theme.get());
  theme.subscribe(() => {
    apply(theme.get());
    try {
      localStorage.setItem(KEY, theme.get());
    } catch {}
  });
}
