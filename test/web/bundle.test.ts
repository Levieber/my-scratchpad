import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { web } from "@scripts/builds";
import { ROOT } from "@test/support";

// What a browser downloads and runs, on the PWA built as it ships (scripts/builds.ts). The rules
// on imports (architecture.test.ts) see one file at a time; these see what a chain of them pulls in.
const dir = mkdtempSync(join(tmpdir(), "pad-bundle-"));
/** Each output file's name and the sources bundled into it. */
let outputs: { file: string; inputs: string[] }[] = [];

beforeAll(async () => {
  const build = await Bun.build({ ...web(dir), root: ROOT, metafile: true });
  if (!build.success || !build.metafile)
    throw new AggregateError(build.logs, "the PWA didn't build");
  outputs = Object.entries(build.metafile.outputs).map(([file, out]) => ({
    file,
    inputs: Object.keys(out.inputs),
  }));
}, 30_000);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const bundled = () => outputs.flatMap((o) => o.inputs);
const chunkOf = (source: string) => outputs.find((o) => o.inputs.some((i) => i.endsWith(source)));

test("no Effect reaches the browser, however indirectly", () => {
  // shared/domain.ts, archive.ts and validation.ts are Schemas: the PWA takes their types only. A
  // value it needs from them (an id's pattern, say) belongs in a shared module without Effect.
  expect(bundled().filter((i) => /node_modules\/(effect|@effect\/)/.test(i))).toEqual([]);
  expect(bundled().filter((i) => /src\/shared\/(domain|archive|validation)\.ts$/.test(i))).toEqual(
    [],
  );
});

test("what opens later is a chunk of its own, not part of what loads at once", () => {
  const entry = chunkOf("src/web/main.tsx");
  expect(entry).toBeDefined();
  for (const lazy of [
    "src/web/components/settings/settings.tsx",
    "src/web/components/editor/history.tsx",
    "src/web/components/notes/note-table.tsx",
    "src/web/components/editor/note-markdown.tsx",
  ]) {
    const chunk = chunkOf(lazy);
    expect([lazy, chunk && chunk !== entry]).toEqual([lazy, true]);
  }
});

test("Query's devtools stay out of the production build", () => {
  expect(bundled().filter((i) => i.includes("react-query-devtools"))).toEqual([]);
});
