import { beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ROOT } from "@test/support";
import tailwind from "bun-plugin-tailwind";

// What a phone and its owner's settings need from the styling. Measuring the rendered layout
// (overflow at 320 px, tap target sizes) takes a browser; these are the rules that keep that
// measurement passing, checked on the CSS the page actually gets (Tailwind compiled from the
// components) and on the class lists of the components themselves.
const WEB = join(ROOT, "src/web");
const html = readFileSync(join(WEB, "index.html"), "utf8");

/** Every .tsx and .ts file of the PWA, by path, except shadcn's (components/ui/). */
const sources = readdirSync(WEB, { recursive: true, encoding: "utf8" })
  .filter((f) => /\.tsx?$/.test(f) && !f.startsWith(join("components", "ui")))
  .map((f) => ({ file: f, text: readFileSync(join(WEB, f), "utf8") }));

let css = "";
beforeAll(async () => {
  const build = await Bun.build({ entrypoints: [join(WEB, "index.html")], plugins: [tailwind] });
  const sheet = build.outputs.find((o) => o.path.endsWith(".css"));
  if (!build.success || !sheet) throw new AggregateError(build.logs, "the PWA didn't build");
  css = await sheet.text();
}, 30_000);

/** Every innermost rule as its selector (or at-rule) and declarations. */
const rules = () =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector = "", body = ""]) => ({
    selector: selector.trim(),
    declarations: Object.fromEntries(
      body
        .split(";")
        .map((d) => d.split(/:(.+)/s).map((s) => s.trim()))
        .filter(([name, value]) => name && value),
    ) as Record<string, string>,
  }));

/** Every string literal in the PWA's sources that holds a class list naming an opacity. */
const opacityClasses = () =>
  sources.flatMap(({ file, text }) =>
    [...text.matchAll(/"([^"\n]*\bopacity-[^"\n]*)"/g)].flatMap(([, list = ""]) =>
      list.split(/\s+/).map((c) => ({ file, c })),
    ),
  );

describe("text size", () => {
  test("sizes are in rem, so the reader's text size setting applies", () => {
    const inPx = rules().flatMap(({ selector, declarations }) =>
      ["font-size", "font"]
        .filter((p) => /^\d*\.?\d+px\b/.test(declarations[p] ?? ""))
        .map((p) => `${selector} { ${p}: ${declarations[p]} }`),
    );
    expect(inPx).toEqual([]);
  });

  test("form fields are at least 1rem: iOS Safari zooms into smaller ones when focused", () => {
    // The base rule every field gets, unless a class on it says more.
    const base = rules().find(
      (r) =>
        /\binput\b/.test(r.selector) &&
        /\btextarea\b/.test(r.selector) &&
        r.declarations["font-size"],
    );
    expect(base?.declarations["font-size"]).toBe("max(1rem, 1em)");
    // No field, nor the class list they share (`field` in lib/classes.ts), sets a smaller size.
    const small = /(^|[\s"])text-(xs|sm|\[0?\.\d+rem\]|\[\d+px\])(?=[\s"]|$)/;
    const fields = sources.flatMap(({ file, text }) =>
      [...text.matchAll(/<(input|textarea)\b[\s\S]*?\/>/g)].map(([el]) => ({ file, el })),
    );
    expect(fields.length).toBeGreaterThan(0);
    const shared = /export const field =\s*"([^"]*)"/.exec(
      sources.find((s) => s.file.endsWith("classes.ts"))?.text ?? "",
    )?.[1];
    expect(shared).toBeDefined();
    expect(small.test(shared ?? "")).toBe(false);
    expect(fields.filter(({ el }) => small.test(el)).map(({ file }) => file)).toEqual([]);
  });

  test("the viewport never disables zoom", () => {
    const viewport = /<meta name="viewport" content="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(viewport).toContain("width=device-width");
    expect(viewport).not.toMatch(/maximum-scale|user-scalable/);
  });
});

describe("narrow screens", () => {
  test("a grid track of 1fr can't shrink below its content: columns use minmax(0, 1fr)", () => {
    const bare = rules().flatMap(({ selector, declarations }) =>
      /(^|\s)1fr(\s|$)/.test(declarations["grid-template-columns"] ?? "")
        ? [`${selector}: ${declarations["grid-template-columns"]}`]
        : [],
    );
    expect(bare).toEqual([]);
  });
});

describe("hover", () => {
  test("only a wide screen with a mouse hides anything until hover, never a phone", () => {
    // desktop-mouse (index.css) is the one place hovering is assumed.
    const variant = /@custom-variant desktop-mouse \(([^;]*)\);/.exec(
      readFileSync(join(WEB, "index.css"), "utf8"),
    )?.[1];
    expect(variant).toContain("hover: hover");
    expect(variant).toContain("pointer: fine");
    expect(variant).toContain("min-width");
    const hidden = opacityClasses()
      .filter(({ c }) => /(^|:)opacity-0$/.test(c) && !c.startsWith("desktop-mouse:"))
      .map(({ file, c }) => `${file}: ${c}`);
    expect(hidden).toEqual([]);
    expect(opacityClasses().some(({ c }) => c === "desktop-mouse:opacity-0")).toBe(true);
  });
});
