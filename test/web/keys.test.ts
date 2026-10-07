import { describe, expect, test } from "bun:test";

import { keysOf, shortcutText } from "@/web/lib/keys";

describe("a shortcut as this device names its keys", () => {
  test("Mod is Ctrl off a Mac, and the other keys stay as written", () => {
    expect(keysOf("Mod+K", false)).toEqual(["Ctrl", "K"]);
    expect(keysOf("Ctrl+Alt+N", false)).toEqual(["Ctrl", "Alt", "N"]);
    expect(shortcutText("Mod+K", false)).toBe("Ctrl+K");
  });

  test("a Mac shows its modifiers as symbols, run together as text", () => {
    expect(keysOf("Mod+B", true)).toEqual(["⌘", "B"]);
    expect(keysOf("Ctrl+Alt+N", true)).toEqual(["⌃", "⌥", "N"]);
    expect(shortcutText("Mod+K", true)).toBe("⌘K");
  });
});
