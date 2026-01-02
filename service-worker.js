const CACHE_NAME = "qr-pwa-v2";
const ASSETS = [
  "./",
  "index.html",
  "manifest.json",
  "images/qr.jpeg",
  "images/icons/icon-120.png",
  "images/icons/icon-152.png",
  "images/icons/icon-167.png",
  "images/icons/icon-180.png",
  "images/icons/icon-192.png",
  "images/icons/icon-256.png",
  "images/icons/icon-384.png",
  "images/icons/icon-512.png",
  "images/icons/icon-192-maskable.png",
  "images/icons/icon-512-maskable.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached;
      }

      return fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      }).catch(() => cached);
    })
  );
});
