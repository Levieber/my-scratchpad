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
  /** Test files too; most rules are about what ships, so they skip them. */
  withTests?: boolean;
  mayNotImport: { specifier: RegExp; because: string; except?: string[] }[];
};

/**
 * A folder of src/ and everything under it, however it is imported. Always by the `@/` alias:
 * `../` is forbidden below, and `./` only reaches a sibling in the same folder.
 */
const under = (path: string, { except }: { except?: string[] } = {}) =>
  new RegExp(`^@\\/${path}(\\/${except ? `(?!(${except.join("|")})(\\/|$))` : ""}.*)?$`);

const CLIENTS = [
  "src/web/**/*.{ts,tsx}",
  "src/cli.ts",
  "src/cli/**/*.ts",
  "src/mcp.ts",
  "src/mcp/**/*.ts",
  "src/client/**/*.ts",
  "integrations/**/*.ts",
];

const SHARED_BECAUSE =
  "shared/ is what the server, the clients and the PWA all use: it knows no process, so nothing in it may reach into one";

const RULES: Rule[] = [
  {
    files: CLIENTS,
    mayNotImport: [
      {
        specifier: under("server"),
        because:
          "clients go through the HTTP API: they never import the server, its routes or its database (API-first)",
        // `pad serve` starts the server process; it never calls it in-process as a client.
        except: ["src/cli/commands/connection.ts"],
      },
      { specifier: /^bun:sqlite$/, because: "only the server's storage opens SQLite" },
    ],
  },
  {
    files: ["src/web/**/*.{ts,tsx}"],
    mayNotImport: [
      { specifier: /^(bun|bun:.*|node:.*)$/, because: "the PWA runs in a browser" },
      {
        specifier: new RegExp(`${under("config").source}|${under("client").source}`),
        because:
          "they read process.env and ~/.config, which a browser doesn't have; use web/api.ts",
      },
    ],
  },
  {
    files: ["src/web/components/**/*.tsx"],
    mayNotImport: [
      {
        specifier: /^@\/web\/lib\/api$/,
        because:
          "components read and write through hooks (src/web/hooks/), which own caching, polling and failures; a component calling the API itself skips all three",
      },
    ],
  },
  {
    files: ["src/server/storage/**/*.ts"],
    mayNotImport: [
      {
        specifier: under("server", { except: ["storage"] }),
        because: "storage knows nothing about HTTP: routes depend on it, not the other way round",
      },
      {
        specifier: new RegExp(
          `${under("client").source}|${under("cli").source}|${under("mcp").source}`,
        ),
        because: "storage belongs to the server alone",
      },
      { specifier: /^@\/shared\/errors$/, because: "the error codes are the HTTP API's" },
      { specifier: /^effect\/http(\/|$)/, because: "storage knows nothing about HTTP" },
    ],
  },
  {
    files: ["src/server/**/*.ts", "src/server.ts"],
    mayNotImport: [
      {
        specifier: new RegExp(
          `${under("client").source}|${under("cli").source}|${under("mcp").source}`,
        ),
        because: "the server doesn't use the clients; it is what they talk to",
      },
    ],
  },
  {
    files: ["src/shared/**/*.ts"],
    mayNotImport: [
      {
        specifier: new RegExp(
          ["server", "client", "cli", "mcp", "config", "web"]
            .map((name) => under(name).source)
            .join("|"),
        ),
        because: SHARED_BECAUSE,
      },
      { specifier: /^@integrations\//, because: SHARED_BECAUSE },
      { specifier: /^(bun|bun:.*|node:.*)$/, because: SHARED_BECAUSE },
    ],
  },
  {
    files: ["src/**/*.{ts,tsx}", "integrations/**/*.ts"],
    mayNotImport: [
      {
        specifier: /^(effect|effect\/[a-z-]+|@effect\/[a-z-]+)$/,
        because:
          "a barrel loads every module it re-exports (Bun doesn't tree-shake at runtime), ~30 ms on each `pad` and hook run; import the module, e.g. effect/Effect",
      },
    ],
  },
  {
    files: ["src/web/**/*.{ts,tsx}"],
    mayNotImport: [
      {
        specifier: /^(effect|@effect\/.*)(\/|$)/,
        because:
          "Effect stays out of the PWA bundle; the browser side is React state and the outbox (see docs/effect.md)",
      },
    ],
  },
  {
    files: ["src/**/*.{ts,tsx}", "integrations/**/*.ts", "test/**/*.ts"],
    withTests: true,
    mayNotImport: [
      {
        specifier: /^\.\.\//,
        because:
          "climbing directories breaks when files move; import by alias (@/ for src, @integrations/ for integrations), `./` for a sibling",
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

function filesFor(globs: string[], withTests = false): string[] {
  const out = new Set<string>();
  for (const pattern of globs)
    for (const file of new Glob(pattern).scanSync({ cwd: ROOT })) out.add(file);
  return [...out].filter((f) => withTests || !f.endsWith(".test.ts")).sort();
}

describe("architecture", () => {
  for (const rule of RULES) {
    for (const file of filesFor(rule.files, rule.withTests)) {
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

  test("a boundary covers its whole folder, and only that folder", () => {
    const server = under("server");
    for (const specifier of ["@/server", "@/server/serve", "@/server/storage/store"])
      expect([specifier, server.test(specifier)]).toEqual([specifier, true]);
    for (const specifier of ["@/serverless", "@/web/server", "@/shared/server", "./server"])
      expect([specifier, server.test(specifier)]).toEqual([specifier, false]);

    const outsideStorage = under("server", { except: ["storage"] });
    for (const specifier of ["@/server/serve", "@/server/routes", "@/server/docs/openapi"])
      expect([specifier, outsideStorage.test(specifier)]).toEqual([specifier, true]);
    for (const specifier of ["@/server/storage/store", "@/server/storage", "@/serverless"])
      expect([specifier, outsideStorage.test(specifier)]).toEqual([specifier, false]);
  });

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
