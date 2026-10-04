import { beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ROOT } from "@test/support";
import tailwind from "bun-plugin-tailwind";

// What a phone and its owner's settings need from the styling, checked on the CSS the page
// actually gets (Tailwind compiled from the components) and on the class lists of the components
// themselves, shadcn's (components/ui/) included: its variants are where most controls get their
// size. test/e2e/layout.test.ts measures the rendered page in a browser.
const WEB = join(ROOT, "src/web");
const html = readFileSync(join(WEB, "index.html"), "utf8");

/** Every .tsx and .ts file of the PWA, by path. */
const sources = readdirSync(WEB, { recursive: true, encoding: "utf8" })
  .filter((f) => /\.tsx?$/.test(f))
  .map((f) => ({ file: f, text: readFileSync(join(WEB, f), "utf8") }));

const source = (file: string) => sources.find((s) => s.file === file)?.text ?? "";

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
    // No field sets a smaller size, at any breakpoint: neither shadcn's Input and Textarea (whose
    // own classes shrink them from `md:`) nor any use of them.
    // (`file:` styles the file picker's button, not what is typed.)
    const small =
      /(^|[\s"])(?!file:)([\w[\]=-]+:)*text-(xs|sm|\[0?\.\d+rem\]|\[\d+px\])(?=[\s"]|$)/;
    const fields = sources.flatMap(({ file, text }) =>
      [...text.matchAll(/<(input|textarea|Input|Textarea|InputPrimitive)\b[\s\S]*?\/>/g)].map(
        ([el]) => ({ file, el }),
      ),
    );
    for (const ui of ["input.tsx", "textarea.tsx"])
      expect(fields.some(({ file }) => file === join("components", "ui", ui))).toBe(true);
    expect(fields.filter(({ el }) => small.test(el)).map(({ file }) => file)).toEqual([]);
  });

  test("the viewport never disables zoom", () => {
    const viewport = /<meta name="viewport" content="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(viewport).toContain("width=device-width");
    expect(viewport).not.toMatch(/maximum-scale|user-scalable/);
  });
});

/** Tailwind's spacing scale: `h-6` is 6 x 0.25rem = 24 px. */
const px = (n: string) => Number(n) * 4;

/** The height a class list gives (`h-N`, `size-N`, `min-h-N`), in px; 0 when it sets none. */
const height = (classes: string) =>
  Math.max(
    0,
    ...[...classes.matchAll(/(?:^|\s)(?:h|size|min-h)-(\d+(?:\.\d+)?)(?=\s|$)/g)].map(
      ([, n = ""]) => px(n),
    ),
  );

describe("tap targets (WCAG 2.2: 24 x 24 px)", () => {
  // Each `size` of a shadcn control, as its cva lists it.
  const sizes = (file: string) => {
    const block = /size:\s*\{([\s\S]*?)\n\s{6}\},/.exec(source(file))?.[1] ?? "";
    return [...block.matchAll(/^\s*"?([\w-]+)"?:\s*"([^"]*)"/gm)].map(
      ([, name = "", classes = ""]) => ({
        name,
        classes,
      }),
    );
  };

  for (const file of [
    join("components", "ui", "button.tsx"),
    join("components", "ui", "toggle.tsx"),
  ])
    test(`every size of ${file} is at least 24 px tall`, () => {
      const all = sizes(file);
      expect(all.length).toBeGreaterThan(2);
      expect(all.filter(({ classes }) => height(classes) < 24).map(({ name }) => name)).toEqual([]);
    });

  test("no Button, Toggle or toggle group item is made smaller where it is used", () => {
    const shrunk = sources.flatMap(({ file, text }) =>
      [...text.matchAll(/<(Button|Toggle|ToggleGroupItem)\b(?:[^<>]|=>)*?className="([^"]*)"/g)]
        .filter(([, , classes = ""]) => height(classes) > 0 && height(classes) < 24)
        .map(([, el, classes]) => `${file}: <${el} className="${classes}">`),
    );
    expect(shrunk).toEqual([]);
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
    // A pseudo-element (`after:`, `before:`) is decoration, such as the tabs' underline, not
    // content kept from a phone.
    const hidden = opacityClasses()
      .filter(
        ({ c }) =>
          /(^|:)opacity-0$/.test(c) &&
          !c.startsWith("desktop-mouse:") &&
          !/(^|:)(after|before):/.test(c),
      )
      .map(({ file, c }) => `${file}: ${c}`);
    expect(hidden).toEqual([]);
    expect(opacityClasses().some(({ c }) => c === "desktop-mouse:opacity-0")).toBe(true);
  });
});
