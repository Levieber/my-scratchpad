// The PWA in a real browser: playwright-core drives the Chrome already on this machine (no browser
// download), against the real server on a fresh in-memory database. What a fake DOM can't show is
// tested here: beforeunload, going offline, real layout. Without a Chrome these tests are skipped,
// not failed, so `bun test` stays usable anywhere; set CHROME to a Chrome's path to run them.
import { afterAll, beforeAll, describe } from "bun:test";
import { existsSync } from "node:fs";

import { type TestServer, testServer } from "@test/support";
import {
  type Browser,
  type BrowserContext,
  chromium,
  type Page,
  type Route,
} from "playwright-core";

import type { Note, NoteInput } from "@/shared/domain";

const CANDIDATES = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];

const chrome =
  [process.env.CHROME, ...CANDIDATES.map((name) => Bun.which(name))].find(
    (path): path is string => Boolean(path) && existsSync(path!),
  ) ?? null;

if (!chrome)
  console.warn(
    "test/e2e: no Chrome found (set CHROME to its path); the browser tests are skipped.",
  );

/** `describe`, or `describe.skip` when there is no Chrome to run it in. */
export const describeE2E = chrome ? describe : describe.skip;

export type App = {
  server: TestServer;
  browser: Browser;
  /** A browser context of its own (its own localStorage, so its own outbox) at `width` px. */
  context: (width?: number) => Promise<BrowserContext>;
  /** A page on the app, loaded and showing its list. */
  open: (width?: number, path?: string) => Promise<Page>;
  /** The API as an agent uses it, beside the browser. */
  api: {
    create: (input: NoteInput) => Promise<Note>;
    get: (id: string) => Promise<Note>;
    append: (id: string, text: string) => Promise<Note>;
  };
};

/** One server and one browser for the file; each test opens the contexts it needs. */
export function useApp(): App {
  const app = {} as App;
  const contexts: BrowserContext[] = [];

  beforeAll(async () => {
    app.server = await testServer();
    app.browser = await chromium.launch({ executablePath: chrome! });
  }, 30_000);
  afterAll(async () => {
    await Promise.all(contexts.map((c) => c.close().catch(() => {})));
    await app.browser?.close();
    await app.server?.stop();
  });

  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetch(new URL(path, app.server.url), {
      method,
      headers: { "content-type": "application/json", "x-pad-author": "agent" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  };
  app.api = {
    create: (input) => call("POST", "/api/notes", input),
    get: (id) => call("GET", `/api/notes/${id}`),
    append: (id, text) => call("POST", `/api/notes/${id}/append`, { text }),
  };

  app.context = async (width = 1280) => {
    const context = await app.browser.newContext({
      baseURL: app.server.url.href,
      viewport: { width, height: 800 },
      // The service worker caches the app and the API; these tests are about the app itself.
      serviceWorkers: "block",
    });
    contexts.push(context);
    return context;
  };
  app.open = async (width, path = "/") => {
    const page = await (await app.context(width)).newPage();
    await page.goto(path);
    await page
      .getByRole("navigation", { name: "Notes" })
      .or(page.locator("main"))
      .first()
      .waitFor();
    return page;
  };
  return app;
}

/** The list's requests (`GET /api/notes?…`), not a single note's. */
export const LIST = /\/api\/notes\?/;

/**
 * Holds the next list response: the server answers at once (so it is what the server had then),
 * and the page receives it only when `release` is called. Later requests go through.
 */
export async function holdNextList(page: Page) {
  let held: (() => Promise<void>) | null = null;
  let arrived!: () => void;
  const started = new Promise<void>((resolve) => (arrived = resolve));
  let taken = false;
  const handler = async (route: Route) => {
    if (taken) return route.continue();
    taken = true;
    const response = await route.fetch();
    held = () => route.fulfill({ response });
    arrived();
  };
  await page.route(LIST, handler);
  return {
    started,
    release: async () => {
      await started;
      await held!();
      await page.unroute(LIST, handler);
    },
  };
}

/** What the poll does every 5 s, now: the app refreshes when the page becomes visible. */
export const poll = (page: Page) =>
  page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

/** The note's row in the list. */
export const row = (page: Page, title: string) =>
  page
    .getByRole("navigation", { name: "Notes" })
    .getByRole("listitem")
    .filter({ has: page.getByRole("button", { name: title }) });

/** Opens the note from its row in the list. */
export const openNote = (page: Page, title: string) =>
  row(page, title).getByRole("button").first().click();

/** Waits until `check` passes, retrying for up to `timeout` ms. */
export async function eventually<T>(check: () => Promise<T> | T, timeout = 5_000): Promise<T> {
  const until = Date.now() + timeout;
  for (;;) {
    try {
      return await check();
    } catch (e) {
      if (Date.now() > until) throw e;
      await Bun.sleep(50);
    }
  }
}
