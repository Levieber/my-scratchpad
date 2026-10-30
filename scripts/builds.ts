// What each build bundles and how, apart from the CLI that runs them (build.ts), so a test can
// build the PWA exactly as it ships.
import type { BuildConfig } from "bun";

import tailwind from "./tailwind";

// React, and the PWA's own check for Query's devtools (web/app.tsx), read it to drop their
// development builds. The server's own config reads NODE_ENV at run time, where it is set anyway.
const production = { "process.env.NODE_ENV": '"production"' };

/** The PWA alone, in chunks: what each `React.lazy` boundary loads is fetched when it is needed. */
export const web = (outdir: string) =>
  ({
    entrypoints: ["src/web/index.html"],
    outdir,
    // Absolute, so a page's address never changes where its files are looked for.
    publicPath: "/",
    minify: true,
    splitting: true,
    plugins: [tailwind],
    define: production,
  }) satisfies BuildConfig;

/**
 * One executable with bytecode, the PWA it serves bundled in. Bundled and minified, the server
 * holds ~10 MB less than it does running from source (docs/deployment.md), and starts in ~40 ms.
 * `split` chunks the PWA, at the cost of the server's own code being chunked too (a larger file,
 * not more memory); `pad` stays one piece, since its hooks run on every session, edit and turn.
 */
export const executable = (entry: string, outfile: string, { split = false } = {}) =>
  ({
    entrypoints: [entry],
    compile: { outfile },
    minify: true,
    bytecode: true,
    format: "esm",
    splitting: split,
    plugins: [tailwind],
    define: production,
  }) satisfies BuildConfig;
