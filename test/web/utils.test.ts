import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ROOT } from "@test/support";

import { cn } from "@/web/lib/utils";

// Every text size the design system adds to Tailwind's scale (index.css).
const sizes = [
  ...readFileSync(join(ROOT, "src/web/index.css"), "utf8").matchAll(/--text-([a-z0-9]+):/g),
].map(([, name]) => name!);

describe("cn", () => {
  test("finds the design system's own text sizes", () => {
    expect(sizes).toEqual(["title", "caption", "label"]);
  });

  for (const size of sizes) {
    test(`keeps text-${size} beside a text color: one is a size, the other a color`, () => {
      expect(cn(`text-${size} text-muted-foreground`)).toBe(`text-${size} text-muted-foreground`);
    });

    test(`lets text-${size} and a size of Tailwind's override each other`, () => {
      expect(cn("text-sm", `text-${size}`)).toBe(`text-${size}`);
      expect(cn(`text-${size}`, "text-xs")).toBe("text-xs");
    });
  }
});
