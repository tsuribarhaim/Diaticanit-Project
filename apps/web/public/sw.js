const CACHE_NAME = "daffy-static-v1";
const PRECACHE_URLS = ["/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => {}),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Deliberately network-passthrough for everything except the two static
// icon files above: this app is inherently online-only (Supabase, live AI
// calls), so caching the app shell for "offline support" would only risk
// serving stale HTML/JS after a deploy - see the PWA plan's own reasoning
// for the version-check banner (app-update-banner.tsx) being the real
// update mechanism instead. This handler exists mainly to satisfy the
// installability criteria Chrome/Android check for (a registered service
// worker with a fetch handler), with a small, safe cache for icons only.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (!PRECACHE_URLS.includes(url.pathname)) return;

  event.respondWith(caches.match(event.request).then((cached) => cached ?? fetch(event.request)));
});
