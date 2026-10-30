#!/usr/bin/env bun
// The builds that bundle the PWA, through Bun.build rather than `bun build`: the CLI doesn't run
// bunfig's [serve.static] plugins, and without the Tailwind plugin (tailwind.ts) the PWA's CSS doesn't compile.
// What each one bundles is in builds.ts.
//
//   bun scripts/build.ts pad [--outfile=path]      `pad`, one executable with bytecode (dist/pad)
//   bun scripts/build.ts server [--outfile=path]   the server alone, the same way (dist/pad-server)
//   bun scripts/build.ts mcp [--outfile=path]      the MCP server over HTTP alone (dist/pad-mcp)
//   bun scripts/build.ts web                       the PWA alone (dist/web), which the server serves in production
import { parseArgs } from "node:util";

import { executable, web } from "./builds";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { outfile: { type: "string" } },
});

const BUILDS = {
  pad: (out = "dist/pad") => executable("src/cli.ts", out),
  server: (out = "dist/pad-server") => executable("src/server.ts", out, { split: true }),
  mcp: (out = "dist/pad-mcp") => executable("src/mcp-http.ts", out),
  web: () => web("dist/web"),
};

const target = positionals[0] ?? "pad";
const config = Object.hasOwn(BUILDS, target)
  ? BUILDS[target as keyof typeof BUILDS](values.outfile)
  : undefined;
if (!config) {
  console.error(`Unknown build "${target}": pad, server, mcp or web`);
  process.exit(2);
}

const result = await Bun.build(config);
for (const log of result.logs) console.error(log);
if (!result.success) process.exit(1);
