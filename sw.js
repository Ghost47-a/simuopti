const CACHE = 'simuopti-1.16.0';
const FICHIERS = ['./', 'index.html', 'simuopti.js', 'manifest.webmanifest', 'icone-192.png', 'icone-512.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// réseau d'abord, sans le cache HTTP du navigateur (GitHub Pages le garde 10 min) : les mises à jour arrivent
// dès la prochaine ouverture ; cache du service worker si hors ligne
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request.url, { cache: 'no-cache' }).then((r) => { const copie = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copie)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
