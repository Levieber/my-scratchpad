import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

import { ROOT } from "@test/support";

// The service worker's fetch handler, run on a stand-in for the worker's scope: what it takes over
// (and so caches) and what it leaves to the network.
const source = await Bun.file(join(ROOT, "public/sw.js")).text();

function worker() {
  const listeners: Record<string, (event: unknown) => void> = {};
  const scope = {
    addEventListener: (type: string, fn: (event: unknown) => void) => void (listeners[type] = fn),
    skipWaiting: () => {},
    clients: { claim: () => {} },
  };
  runInNewContext(source, {
    self: scope,
    caches: {
      open: () => Promise.resolve({ put: () => {} }),
      match: () => Promise.resolve(undefined),
    },
    location: new URL("http://pad.test"),
    // The network never answers: only whether the worker took the request is asked.
    fetch: () => new Promise(() => {}),
    URL,
    Headers,
    Response,
  });
  /** Whether the worker answered a request of its own accord, rather than leaving it alone. */
  return (path: string, method = "GET") => {
    let taken = false;
    listeners.fetch?.({
      request: { method, url: `http://pad.test${path}`, mode: "cors" },
      respondWith: () => void (taken = true),
    });
    return taken;
  };
}

describe("service worker", () => {
  const takes = worker();

  test("serves the notes and the rest of the API from its cache when offline", () => {
    expect(takes("/api/notes?limit=50")).toBe(true);
    expect(takes("/api/import")).toBe(true);
  });

  test("leaves an export to the network: it is a copy of every note, not something to keep or replay", () => {
    expect(takes("/api/export")).toBe(false);
    expect(takes("/api/export?q=zebra&history=false")).toBe(false);
  });

  test("leaves writes alone", () => {
    expect(takes("/api/import", "POST")).toBe(false);
  });
});
