import { describe, expect, test } from "bun:test";

import type { ImportResult } from "@/shared/archive";
import {
  exportFilename,
  exportPath,
  importSummary,
  readImportFile,
  tooLarge,
} from "@/web/lib/transfer";

const result = (over: Partial<ImportResult> = {}): ImportResult => ({
  created: 0,
  skipped: 0,
  views: { created: 0, skipped: 0 },
  pins: { created: 0, skipped: 0 },
  hook_selections: { created: 0, skipped: 0 },
  failed: [],
  ...over,
});

describe("what is exported", () => {
  test("the whole archive with history by default, a search and no history on request", () => {
    expect(exportPath("", true)).toBe("/api/export");
    expect(exportPath("  ", true)).toBe("/api/export");
    expect(exportPath("kind:reference #launch seo", false)).toBe(
      "/api/export?q=kind%3Areference+%23launch+seo&history=false",
    );
  });

  test("the file is named for the day it was made", () => {
    expect(exportFilename("2026-10-04T23:59:00.000Z")).toBe("pad-export-2026-10-04.json");
  });
});

describe("what is imported", () => {
  test("a file over what the server takes is refused before it is sent, saying by how much it may be", () => {
    expect(tooLarge(10, undefined)).toBeNull();
    expect(tooLarge(10, 10)).toBeNull();
    expect(tooLarge(11 * 1024 * 1024, 10 * 1024 * 1024)).toBe(
      "This file is 11 MB; the server takes at most 10 MB.",
    );
  });

  test("a file is read as JSON, or refused in words", () => {
    expect(readImportFile('{"a":1}')).toEqual({ data: { a: 1 } });
    expect(readImportFile("[1]")).toEqual({ data: [1] });
    expect(readImportFile("not json")).toEqual({
      error: "This is not a JSON file. Choose one made by Export.",
    });
    expect(readImportFile("")).toEqual({
      error: "This is not a JSON file. Choose one made by Export.",
    });
  });

  test("the result says what was created and what was left alone, and only for the parts that had any", () => {
    expect(importSummary(result({ created: 3, skipped: 1 }))).toEqual([
      "3 notes imported, 1 already here and left as it is.",
    ]);
    expect(
      importSummary(
        result({
          created: 1,
          views: { created: 2, skipped: 0 },
          pins: { created: 1, skipped: 1 },
          hook_selections: { created: 0, skipped: 1 },
        }),
      ),
    ).toEqual([
      "1 note imported.",
      "2 saved searches imported.",
      "1 pin imported, 1 already here.",
      "1 hook choice already here.",
    ]);
  });

  test("notes that were all here already are said so, and an empty file says nothing came", () => {
    expect(importSummary(result({ skipped: 2 }))).toEqual([
      "2 notes already here and left as they are.",
    ]);
  });

  test("an import of nothing new says so", () => {
    expect(importSummary(result())).toEqual(["Nothing to import."]);
  });
});
