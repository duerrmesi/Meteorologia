// Service Worker Cache-Name für die Progressive Web App
// Bei jeder Änderung an den gecachten Dateien die Versionsnummer erhöhen!
const CACHE_NAME = 'wetter-dashboard-v13';
const SYNC_TAG = 'weather-sync';


// Liste aller Dateien, die lokal auf dem Smartphone zwischengespeichert werden sollen
const ASSETS = [
  './index.html',
  './style.css?v=13',
  './manifest.json?v=13',
  './src/types.js',
  './src/utils.js',
  './src/api.js',
  './src/charts.js',
  './src/app.js'
];

// Installation des Service Workers und Abspeichern der statischen Assets im Browser-Cache
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  // Neuen Service Worker sofort aktivieren, ohne auf Reload zu warten
  self.skipWaiting();
});

// FIX #13: Alte Cache-Versionen beim Aktivieren aufräumen
// Ohne dieses Event bleiben alte Caches (v1, v2, v3...) für immer im Browser gespeichert
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    )
  );
  // Sofort die Kontrolle über alle offenen Tabs/Fenster übernehmen
  self.clients.claim();
});

// Background Sync für fehlgeschlagene API-Calls
self.addEventListener('sync', (e) => {
  if (e.tag === SYNC_TAG) {
    e.waitUntil(syncWeatherData());
  }
});

async function syncWeatherData() {
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({ type: 'SYNC_TRIGGERED' });
  });
}

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
