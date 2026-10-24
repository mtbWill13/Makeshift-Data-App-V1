const CACHE_NAME = "makeshift-scouting-v26";
const APP_SHELL = [
  "/scouting/",
  "/scouting/index.js",
  "/scouting/styles.css",
  "/pitScouting/",
  "/pitScouting/index.js",
  "/pitScouting/styles.css",
  "/offline.js",
  "/scout-ui.js",
  "/scout-ui.css",
  "/event-lists.js",
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

/* Only real files are worth saving. When nobody is logged in the server sends
   everyone to the login page, and saving that page in place of a form page or
   script (as an earlier version did) breaks the page every time it's opened. */
function isRealFile(response) {
  return response.ok && !response.redirected && response.type !== "opaqueredirect";
}

/* Saves the offline pages and scripts. Anything that can't be fetched right now
   (no connection, or not logged in) is skipped, not fatal: it is saved the first
   time it is opened while logged in. */
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => Promise.all(APP_SHELL.map(async url => {
      try {
        const response = await fetch(url, { credentials: "same-origin" });
        if (isRealFile(response)) await cache.put(url, response);
      } catch {
        /* skipped; see above */
      }
    })))
  );
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
          if (isRealFile(response)) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then(cached => cached || Response.error()))
    );
    return;
  }

  /* Pages outside the offline app shell (main page, picklist, compare…) aren't
     needed offline, so always fetch them fresh and only fall back to a cached
     copy without a connection. Serving them cache-first showed stale pages. */
  const url = new URL(event.request.url);
  const inShell = url.origin === location.origin && APP_SHELL.includes(url.pathname);
  const isAsset = /^\/(fonts|images|vendor)\//.test(url.pathname);

  if (url.origin === location.origin && !inShell && !isAsset) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (isRealFile(response)) {
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
    caches.match(event.request).then(saved => {
      /* A saved copy that is the login page (or any redirect) is never used. */
      const cached = saved && isRealFile(saved) ? saved : null;

      const network = fetch(event.request)
        .then(response => {
          if (isRealFile(response) && new URL(event.request.url).origin === location.origin) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached || Response.error());

      return cached || network;
    })
  );
});
