import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Glob } from "bun";

/**
 * The API-first rule, written down where it can fail a build: every client goes through the HTTP
 * API, and only the server touches the database. Each rule says why, so a failure explains itself.
 * Type-only imports are allowed everywhere — sharing a type couples nothing at runtime.
 */
type Rule = {
  /** Globs (from the repo root) the rule applies to. */
  files: string[];
  mayNotImport: { specifier: RegExp; because: string; except?: string[] }[];
};

const CLIENTS = [
  "src/web/**/*.{ts,tsx}",
  "src/cli.ts",
  "src/mcp.ts",
  "src/client.ts",
  "integrations/**/*.ts",
];

const RULES: Rule[] = [
  {
    files: CLIENTS,
    mayNotImport: [
      {
        specifier: /^\.{1,2}\/(.*\/)?(db|migrations)(\.ts)?$/,
        because: "clients go through the HTTP API, never the database (API-first)",
      },
      { specifier: /^bun:sqlite$/, because: "only the server's storage opens SQLite" },
      {
        specifier: /^\.{1,2}\/(.*\/)?server(\.ts)?$/,
        because: "clients talk to the server over HTTP, not by importing it",
        // `pad serve` starts the server process; it never calls it in-process as a client.
        except: ["src/cli.ts"],
      },
    ],
  },
  {
    files: ["src/web/**/*.{ts,tsx}"],
    mayNotImport: [
      { specifier: /^(bun|bun:.*|node:.*)$/, because: "the PWA runs in a browser" },
      {
        specifier: /^\.{1,2}\/(.*\/)?(config|client)(\.ts)?$/,
        because:
          "they read process.env and ~/.config, which a browser doesn't have; use web/api.ts",
      },
    ],
  },
  {
    files: ["src/db.ts", "src/migrations.ts"],
    mayNotImport: [
      {
        specifier: /^\.{1,2}\/(.*\/)?(server|client|openapi|errors)(\.ts)?$/,
        because: "storage knows nothing about HTTP",
      },
    ],
  },
];

type Import = { specifier: string; typeOnly: boolean };

/** Static imports/re-exports and dynamic `import()`, with whether they are type-only. */
function importsOf(source: string): Import[] {
  const found: Import[] = [];
  const statement = /^\s*(import|export)\s+(type\s+)?([\s\S]*?)\s*from\s*["']([^"']+)["']/gm;
  for (const [, , typeKeyword, clause = "", specifier = ""] of source.matchAll(statement)) {
    // `import { type A, type B } from` is type-only too; a default or namespace import never is.
    const named = /^\{([\s\S]*)\}$/.exec(clause.trim())?.[1];
    const allInlineTypes =
      named !== undefined &&
      named
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .every((s) => s.startsWith("type "));
    found.push({ specifier, typeOnly: Boolean(typeKeyword) || allInlineTypes });
  }
  for (const [, specifier = ""] of source.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) {
    found.push({ specifier, typeOnly: false });
  }
  for (const [, specifier = ""] of source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
    found.push({ specifier, typeOnly: false });
  }
  return found;
}

const ROOT = join(import.meta.dir, "..");

function filesFor(globs: string[]): string[] {
  const out = new Set<string>();
  for (const pattern of globs)
    for (const file of new Glob(pattern).scanSync({ cwd: ROOT })) out.add(file);
  return [...out].filter((f) => !f.endsWith(".test.ts")).sort();
}

describe("architecture", () => {
  for (const rule of RULES) {
    for (const file of filesFor(rule.files)) {
      test(`${file} respects its import boundaries`, () => {
        const violations = importsOf(readFileSync(join(ROOT, file), "utf8"))
          .filter((i) => !i.typeOnly)
          .flatMap(({ specifier }) =>
            rule.mayNotImport
              .filter((r) => r.specifier.test(specifier) && !r.except?.includes(file))
              .map((r) => `${file} imports "${specifier}": ${r.because}`),
          );
        expect(violations).toEqual([]);
      });
    }
  }

  test("every rule matches at least one file (a typo would silently disable it)", () => {
    for (const rule of RULES) expect(filesFor(rule.files).length).toBeGreaterThan(0);
  });

  test("the import parser sees what the rules rely on", () => {
    const parsed = importsOf(`
      import type { Note } from "../db";
      import { type A, type B } from "./db";
      import { Store, type NoteInput } from "./db";
      import {
        readError,
      } from "./errors";
      import "./side-effect";
      export { x } from "./server";
      const s = await import("./server");
    `);
    expect(parsed).toEqual([
      { specifier: "../db", typeOnly: true },
      { specifier: "./db", typeOnly: true },
      { specifier: "./db", typeOnly: false },
      { specifier: "./errors", typeOnly: false },
      { specifier: "./server", typeOnly: false },
      { specifier: "./side-effect", typeOnly: false },
      { specifier: "./server", typeOnly: false },
    ]);
  });
});
