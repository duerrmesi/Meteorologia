// Service Worker Cache-Name für die Progressive Web App
const CACHE_NAME = 'wetter-dashboard-v4';

// Liste aller Dateien, die lokal auf dem Smartphone zwischengespeichert werden sollen
const ASSETS = [
  './index.html',
  './style.css',
  './app.js',
  './manifest.json'
];

// Installation des Service Workers und Abspeichern der statischen Assets im Browser-Cache
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

// Abfangen von Netzwerk-Anfragen
self.addEventListener('fetch', (e) => {
  // WICHTIG: Live-Datenbankanfragen an Firebase dürfen NIEMALS gecacht werden!
  if (e.request.url.includes('firebasedatabase.app')) return;
  
  // Lädt Dateien aus dem Cache; falls nicht vorhanden, über das Internet
  e.respondWith(
    caches.match(e.request).then((response) => {
      return response || fetch(e.request);
    })
  );
});
