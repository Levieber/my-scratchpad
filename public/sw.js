// Runtime caching (bundle filenames are content-hashed, so there is no fixed shell list):
// - pages & API GETs: network-first, cached fallback -> notes stay readable offline
// - other assets: cache-first (hashed names never change)
const CACHE = "scratchpad-v2";

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

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;

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
          caches.match(req).then((r) => r ?? Response.json({ error: "offline" }, { status: 503 })),
        ),
    );
  } else {
    e.respondWith(caches.match(req).then((r) => r ?? fetch(req).then((res) => put(req, res))));
  }
});
