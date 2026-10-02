#!/usr/bin/env bun
// The builds that bundle the PWA, through Bun.build rather than `bun build`: the CLI doesn't run
// bunfig's [serve.static] plugins, and without bun-plugin-tailwind the PWA's CSS doesn't compile.
//
//   bun scripts/build.ts pad [--outfile=path]   `pad`, one executable with bytecode (dist/pad)
//   bun scripts/build.ts web                    the PWA alone, to inspect its output (dist/)
import { parseArgs } from "node:util";

import tailwind from "bun-plugin-tailwind";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { outfile: { type: "string", default: "dist/pad" } },
});

const result =
  positionals[0] === "web"
    ? await Bun.build({
        entrypoints: ["src/web/index.html"],
        outdir: "dist",
        minify: true,
        plugins: [tailwind],
        define: { "process.env.NODE_ENV": '"production"' },
      })
    : await Bun.build({
        entrypoints: ["src/cli.ts"],
        compile: { outfile: values.outfile },
        minify: true,
        bytecode: true,
        format: "esm",
        plugins: [tailwind],
      });

for (const log of result.logs) console.error(log);
if (!result.success) process.exit(1);
