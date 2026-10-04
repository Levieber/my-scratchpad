import { describe, expect, test } from "bun:test";

import * as Schema from "effect/Schema";

import { KnownViewOptions, LAYOUT_OPTIONS } from "@/shared/domain";
import {
  DEFAULT_LAYOUT,
  LAYOUT_KEYS,
  LAYOUTS,
  LAYOUTS_VERSION,
  mergePatch,
  replacing,
  shownLayout,
} from "@/shared/layouts";

describe("layouts", () => {
  test("keys are unique, the default is one of them, and each has its options", () => {
    expect(new Set(LAYOUT_KEYS).size).toBe(LAYOUT_KEYS.length);
    expect(LAYOUT_KEYS).toContain(DEFAULT_LAYOUT);
    for (const { since } of LAYOUTS) expect(since).toBeLessThanOrEqual(LAYOUTS_VERSION);
    expect(Object.keys(LAYOUT_OPTIONS).toSorted()).toEqual([...LAYOUT_KEYS].toSorted());
  });

  test("every layout's options are checked on a view", () => {
    for (const fields of Object.values(LAYOUT_OPTIONS))
      for (const [name, schema] of Object.entries(fields))
        expect([
          name,
          KnownViewOptions.fields[name as keyof typeof KnownViewOptions.fields],
        ]).toEqual([name, schema]);
  });

  test("a view without a layout shows the device's preference", () => {
    expect(shownLayout(null, "grid")).toEqual({ layout: "grid" });
    expect(shownLayout(undefined)).toEqual({ layout: DEFAULT_LAYOUT });
    expect(shownLayout("table", "grid")).toEqual({ layout: "table" });
  });

  test("a layout from a newer app shows as the list, and says which it was", () => {
    expect(shownLayout("calendar", "grid")).toEqual({ layout: "list", unknown: "calendar" });
  });
});

describe("mergePatch (RFC 7396)", () => {
  test("merges objects key by key, removes keys set to null, replaces anything else", () => {
    const target = { sort: { by: "title", desc: true, nulls: "last" }, future: [1, 2], keep: 1 };
    expect(mergePatch(target, { sort: { desc: null }, future: [3], gone: null })).toEqual({
      sort: { by: "title", nulls: "last" },
      future: [3],
      keep: 1,
    });
  });

  test("leaves its target as it was", () => {
    const target = { a: { b: 1 } };
    mergePatch(target, { a: { b: 2 } });
    expect(target).toEqual({ a: { b: 1 } });
  });

  test("a patch that isn't an object replaces the whole", () => {
    expect(mergePatch({ a: 1 }, [1])).toEqual([1]);
    expect(mergePatch("x", { a: 1 })).toEqual({ a: 1 });
  });
});

describe("KnownViewOptions", () => {
  test("checks the options it knows and lets the others through", () => {
    const check = Schema.is(KnownViewOptions);
    expect(check({ sort: { by: "updated", desc: true }, swimlanes: "status:" })).toBe(true);
    expect(check({ sort: { by: "colour" } })).toBe(false);
  });
});

describe("replacing", () => {
  test("is the merge patch that turns one value into another as a whole", () => {
    const current = { by: "prefix", prefix: "status:", columns: ["todo"] };
    const next = { by: "tags", tags: ["urgent"] };
    const patch = replacing(current, next);
    expect(patch).toEqual({ by: "tags", tags: ["urgent"], prefix: null, columns: null });
    expect(mergePatch(current, patch)).toEqual(next);
    expect(replacing(undefined, next)).toEqual(next);
  });
});
