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
    // Scrollbars drawn, as a person sees them: headless Chrome hides them by default, and with
    // them the gutters the layout keeps for them (test/e2e/scroll.test.ts).
    app.browser = await chromium.launch({
      executablePath: chrome!,
      ignoreDefaultArgs: ["--hide-scrollbars"],
    });
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
 * Holds the next response to a GET matching `url` (the list's, by default): the server answers at
 * once (so it is what the server had then), and the page receives it only when `release` is
 * called. Later requests go through.
 */
export async function holdNext(page: Page, url: RegExp = LIST) {
  let held: (() => Promise<void>) | null = null;
  let arrived!: () => void;
  const started = new Promise<void>((resolve) => (arrived = resolve));
  let taken = false;
  const handler = async (route: Route) => {
    if (taken || route.request().method() !== "GET") return route.fallback();
    taken = true;
    const response = await route.fetch();
    held = () => route.fulfill({ response });
    arrived();
  };
  await page.route(url, handler);
  return {
    started,
    release: async () => {
      await started;
      await held!();
      await page.unroute(url, handler);
    },
  };
}

/** What the poll does every 5 s, now: the app refreshes when the page becomes visible (the real event bubbles, and Query listens on window). */
export const poll = (page: Page) =>
  page.evaluate(() => document.dispatchEvent(new Event("visibilitychange", { bubbles: true })));

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

/** Every element scrolling vertically right now (the page itself included), as `tag[aria-label]` with its box and its scrollbar's width. */
export const scrollers = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("*")]
      .filter((el) => {
        if (el.scrollHeight <= el.clientHeight + 1) return false;
        return (
          el === document.scrollingElement || /auto|scroll/.test(getComputedStyle(el).overflowY)
        );
      })
      .map((el) => {
        const { left, right } = el.getBoundingClientRect();
        const label = el.getAttribute("aria-label");
        return {
          name: `${el.tagName.toLowerCase()}${label ? `[${label}]` : ""}`,
          left: Math.round(left),
          right: Math.round(right),
          scrollbar: el.offsetWidth - el.clientWidth,
        };
      }),
  );

// What a pointer or a finger aims at. An inline link in a sentence would be exempt (WCAG 2.5.8);
// the app has none.
const TARGETS =
  "button, a[href], input, textarea, select, [role=button], [role=link], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=radio], [role=checkbox], [role=switch], [role=tab], [role=option]";

/** Whatever on the page breaks a phone's rules (sideways scroll, small targets, small fields), as readable lines; empty when it all holds. */
export const violations = (page: Page) =>
  page.evaluate((targets) => {
    const found: string[] = [];
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth)
      found.push(`scrolls sideways: ${root.scrollWidth} > ${root.clientWidth}`);
    for (const el of document.querySelectorAll<HTMLElement>(targets)) {
      if (!el.checkVisibility({ visibilityProperty: true })) continue;
      // Base UI's checkbox mirrors its state into a hidden native input (1 px, aria-hidden, out
      // of the tab order) for forms; nobody aims at it.
      if (el.closest("[aria-hidden=true]")) continue;
      const box = el.getBoundingClientRect();
      const name = `${el.tagName.toLowerCase()} "${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30) ?? ""}"`;
      if (box.width < 24 || box.height < 24)
        found.push(`${name} is ${Math.round(box.width)}x${Math.round(box.height)}`);
      if (el.matches("input, textarea, select")) {
        const size = parseFloat(getComputedStyle(el).fontSize);
        if (size < 16) found.push(`${name} has a ${size}px font`);
      }
    }
    return found;
  }, TARGETS);
