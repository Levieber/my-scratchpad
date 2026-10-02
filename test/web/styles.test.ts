import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ROOT } from "@test/support";

// What a phone and its owner's settings need from the stylesheet, checked on the source. Measuring
// the rendered layout (overflow at 320 px, tap target sizes) takes a browser; these are the rules
// that keep that measurement passing.
const css = readFileSync(join(ROOT, "src/web/styles.css"), "utf8");
const html = readFileSync(join(ROOT, "src/web/index.html"), "utf8");

/** Every rule as its selector and declarations, at any depth of @media. */
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector = "", body = ""]) => ({
  selector: selector.trim(),
  declarations: Object.fromEntries(
    body
      .split(";")
      .map((d) => d.split(/:(.+)/s).map((s) => s.trim()))
      .filter(([name, value]) => name && value),
  ) as Record<string, string>,
}));

/** `1.25rem` and `20px` in CSS pixels, assuming the default 16px root. */
const toPx = (value: string) => {
  const m = /^(\d*\.?\d+)(rem|px)\b/.exec(value);
  return m ? Number(m[1]) * (m[2] === "rem" ? 16 : 1) : undefined;
};

describe("text size", () => {
  test("sizes are in rem, so the reader's text size setting applies", () => {
    const inPx = rules.flatMap(({ selector, declarations }) =>
      ["font-size", "font"]
        .filter((p) => /^\d*\.?\d+px\b/.test(declarations[p] ?? ""))
        .map((p) => `${selector} { ${p}: ${declarations[p]} }`),
    );
    expect(inPx).toEqual([]);
  });

  test("form fields are at least 1rem: iOS Safari zooms into smaller ones when focused", () => {
    const fields = rules.filter(({ selector }) =>
      selector.split(",").some((s) => /(^|[\s.])(input|textarea|tagsInput|title)\b/.test(s)),
    );
    expect(fields.length).toBeGreaterThan(0);
    const tooSmall = fields.flatMap(({ selector, declarations }) => {
      const sizes = [declarations["font-size"], declarations["font"]?.split("/")[0]];
      return sizes
        .map((s) => (s ? toPx(s) : undefined))
        .filter((px): px is number => px !== undefined && px < 16)
        .map((px) => `${selector}: ${px}px`);
    });
    expect(tooSmall).toEqual([]);
    // The shared rule that makes every field 1rem unless a rule above says more.
    expect(rules.some((r) => r.selector.includes("textarea") && r.declarations["font-size"])).toBe(
      true,
    );
  });

  test("the viewport never disables zoom", () => {
    const viewport = /<meta name="viewport" content="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(viewport).toContain("width=device-width");
    expect(viewport).not.toMatch(/maximum-scale|user-scalable/);
  });
});

describe("narrow screens", () => {
  test("a grid track of 1fr can't shrink below its content: columns use minmax(0, 1fr)", () => {
    const bare = rules.flatMap(({ selector, declarations }) =>
      /(^|\s)1fr(\s|$)/.test(declarations["grid-template-columns"] ?? "")
        ? [`${selector}: ${declarations["grid-template-columns"]}`]
        : [],
    );
    expect(bare).toEqual([]);
  });
});
