// A keyboard shortcut as this device's keyboard names its keys: `Mod` is ⌘ on a Mac and Ctrl
// elsewhere, and a Mac shows its modifiers as symbols. The handlers read the same keys
// (hooks/shortcuts.hook.ts, the Write view).
const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

const ON_MAC: Record<string, string> = { Mod: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧" };

/** `"Mod+K"` as its keys: ["⌘", "K"] on a Mac, ["Ctrl", "K"] elsewhere. */
export const keysOf = (shortcut: string, mac = MAC): string[] =>
  shortcut.split("+").map((k) => (mac ? (ON_MAC[k] ?? k) : k === "Mod" ? "Ctrl" : k));

/** The shortcut as text, where a <kbd> can't go (a placeholder): "⌘K", or "Ctrl+K". */
export const shortcutText = (shortcut: string, mac = MAC): string =>
  keysOf(shortcut, mac).join(mac ? "" : "+");
