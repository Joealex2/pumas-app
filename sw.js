const CACHE_NAME = 'pumas-auto-update-v48';

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

// Estrategia Network First: busca siempre la última versión en internet y
// revalida con el servidor para no servir archivos viejos desde la caché.
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const isLoginNav = event.request.mode === 'navigate' &&
    (url.searchParams.has('usuario') || url.searchParams.has('password'));
  if (isLoginNav) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }));
    return;
  }

  event.respondWith(
    fetch(event.request, { cache: 'no-cache' })
      .then(networkResponse => {
        const copy = networkResponse.clone();
        caches.open(CACHE_NAME)
          .then(cache => cache.put(event.request, copy))
          .catch(() => {});
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});
