const CACHE_NAME = 'pumas-cache-v3';
const ASSETS = [
  '/pumas-app/',
  '/pumas-app/index.html',
  '/pumas-app/styles.css',
  '/pumas-app/app.js',
  '/pumas-app/manifest.json',
  '/pumas-app/img/Pum.png'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
