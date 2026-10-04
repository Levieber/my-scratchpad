// Runtime caching (bundle filenames are content-hashed, so there is no fixed shell list):
// - pages & API GETs: network-first, cached fallback -> notes stay readable offline
// - other assets: cache-first (hashed names never change)
// Writes are never intercepted: offline, they fail, and the PWA's outbox keeps them (src/web/lib/outbox.ts).
const CACHE = "scratchpad-v4";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const put = (req, res) => {
  if (res.ok) {
    const copy = res.clone();
    // Fire-and-forget: the response goes back to the page without waiting for the cache write.
    void caches.open(CACHE).then((c) => c.put(req, copy));
  }
  return res;
};

// Answers from the cache carry this header, so the page knows it is offline even though the
// request succeeded (src/web/api.ts).
const fromCache = (res) => {
  const headers = new Headers(res.headers);
  headers.set("x-pad-offline", "1");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
};

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  // An export is every note, made to be saved, never to be read back from here: a copy kept in the
  // cache would sit there as a second dump of the notes, and offline it would pass for a fresh one.
  if (url.pathname === "/api/export") return;

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => put("/", res))
        .catch(() => caches.match("/")),
    );
  } else if (url.pathname.startsWith("/api/")) {
    e.respondWith(
      fetch(req)
        .then((res) => put(req, res))
        .catch(() =>
          caches
            .match(req)
            .then((r) =>
              fromCache(
                r ?? Response.json({ error: "offline", message: "Offline" }, { status: 503 }),
              ),
            ),
        ),
    );
  } else {
    e.respondWith(caches.match(req).then((r) => r ?? fetch(req).then((res) => put(req, res))));
  }
});
