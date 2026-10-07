// Compiles the PWA's Tailwind, with the compiler this project pins (`tailwindcss` in package.json).
// bun-plugin-tailwind, Tailwind's own Bun plugin, bundles a compiler of its own: 0.1.2 carried
// 4.1.14, so what 4.2 and 4.3 added (`scrollbar-*`, `scrollbar-gutter-*`, logical `inline-*`,
// `@variant` with stacked variants) silently compiled to nothing. This is the same two parts
// Tailwind's Vite and PostCSS plugins are built on: `@tailwindcss/node` compiles the stylesheet,
// `@tailwindcss/oxide` finds the class names in the sources it names (`@source`, index.css).
//
// Used by bunfig's [serve.static] (dev and the server's HTML import), scripts/build.ts and the
// style tests. It scans the files rather than the bundle's module graph, so a rebuild sees
// classes in any file under the stylesheet's sources.
import { dirname } from "node:path";

import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import type { BunPlugin } from "bun";

// tailwindcss's `Features`, a const enum, which `verbatimModuleSyntax` can't read from its types.
// A stylesheet using none of these isn't Tailwind's to compile: Bun's CSS loader takes it as it is.
const AT_APPLY = 1;
const JS_PLUGIN = 4;
const THEME_FUNCTION = 8;
const UTILITIES = 16;
const TAILWIND = AT_APPLY | JS_PLUGIN | THEME_FUNCTION | UTILITIES;

async function build(path: string): Promise<string | undefined> {
  const compiler = await compile(await Bun.file(path).text(), {
    base: dirname(path),
    from: path,
    onDependency: () => {},
    shouldRewriteUrls: true,
  });
  if (!(compiler.features & TAILWIND)) return undefined;
  if (!(compiler.features & UTILITIES)) return compiler.build([]);
  const root =
    compiler.root === "none"
      ? []
      : [{ ...(compiler.root ?? { base: process.cwd(), pattern: "**/*" }), negated: false }];
  const scanner = new Scanner({ sources: [...root, ...compiler.sources] });
  return compiler.build(scanner.scan());
}

const tailwind: BunPlugin = {
  name: "tailwindcss",
  setup(plugin) {
    plugin.onLoad({ filter: /\.css$/ }, async ({ path }) => {
      const contents = await build(path);
      return contents === undefined ? undefined : { contents, loader: "css" };
    });
  },
};

export default tailwind;
