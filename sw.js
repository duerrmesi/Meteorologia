const CACHE_NAME = 'wetter-dashboard-v1';
const ASSETS = [
  './index.html',
  './manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', (e) => {
  // Netzwerk-First Strategie für API und externe Skripte, ansonsten Cache
  if (e.request.url.includes('firebasedatabase.app')) return; // Firebase nicht cachen!
  
  e.respondWith(
    caches.match(e.request).then((response) => {
      return response || fetch(e.request);
    })
  );
});
