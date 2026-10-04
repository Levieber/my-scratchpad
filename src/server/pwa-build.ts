// The PWA built ahead of serving it. Bun can bundle the app from its HTML import on the first
// request, but then the bundler and Tailwind's compiler stay in this process for as long as it
// runs (~80 MB of RSS, measured). Built by a process of its own, they are gone when it exits.
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

import * as Effect from "effect/Effect";

const ROOT = join(import.meta.dir, "..", "..");
const SCRIPT = join(ROOT, "scripts", "build.ts");

/** Where `scripts/build.ts web` writes. */
export const PREBUILT = join(ROOT, "dist", "web");

/**
 * Builds the PWA into `PREBUILT` and succeeds with that folder, or with nothing when it can't:
 * a compiled `pad` has no source tree to build from, and a tree that can't be written to has
 * nowhere to build into. The server then bundles on demand as it always did, so this is only ever
 * an optimisation. Built at each start rather than at deploy, so a pulled change is never served
 * as the old build.
 */
export const buildPwa = Effect.tryPromise(async () => {
  if (!existsSync(SCRIPT)) return undefined;
  // A failed build must not leave the last one to be served.
  rmSync(PREBUILT, { recursive: true, force: true });
  const code = await Bun.spawn([process.execPath, SCRIPT, "web"], { cwd: ROOT, stdout: "ignore" })
    .exited;
  return code === 0 && existsSync(join(PREBUILT, "index.html")) ? PREBUILT : undefined;
}).pipe(Effect.orElseSucceed(() => undefined));
