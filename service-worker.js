const CACHE_NAME = 'my-daily-paper-v4';
const APP_SHELL = [
  './',
  './app.html?v=20260911-2',
  './app.html',
  './pwa.html',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon-maskable.svg',
  './db.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const request = event.request;
  event.respondWith(
    fetch(request, { cache: 'no-store' })
      .then(response => {
        if (response && response.status === 200 && response.type !== 'opaque') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === 'navigate') {
          return (await caches.match('./app.html?v=20260911-2')) || (await caches.match('./app.html'));
        }
        return Response.error();
      })
  );
});
