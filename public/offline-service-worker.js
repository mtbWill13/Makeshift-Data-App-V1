const CACHE_NAME = "makeshift-scouting-v16";
const APP_SHELL = [
  "/scouting/",
  "/scouting/index.js",
  "/scouting/styles.css",
  "/pitScouting/",
  "/pitScouting/index.js",
  "/pitScouting/styles.css",
  "/offline.js",
  "/transfer/",
  "/transfer/index.js",
  "/transfer/styles.css",
  "/event/",
  "/event/index.js",
  "/event/styles.css",
  "/theme.css",
  "/fonts/dm-sans-latin.woff2",
  "/images/makeshift-logo-wide.png",
  "/vendor/qrcode.js"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  /* Live data must be fresh: try the network first and only fall back to
     the last cached copy (e.g. the match schedule) when offline. */
  if (new URL(event.request.url).pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then(cached => cached || Response.error()))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      const network = fetch(event.request)
        .then(response => {
          if (response.ok && new URL(event.request.url).origin === location.origin) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);

      return cached || network;
    })
  );
});
