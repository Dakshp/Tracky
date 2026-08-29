// App-shell cache so Tracky opens instantly and works with no connection.
// Bump CACHE whenever app files change - the old cache is then dropped. It
// usually tracks app.js's APP_VERSION, but it has to move even when the
// visible version deliberately does not, so it carries its own suffix.
const CACHE = 'tracky-v26-3';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './storage.js',
  './csv.js',
  './sync.js',
  './manifest.webmanifest',
  './icons/icon-192.png?v=26',
  './icons/icon-512.png?v=26',
  './icons/icon-maskable-512.png?v=26',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' bypasses the browser's own HTTP cache. GitHub Pages serves
  // these files with a ten-minute max-age, so a plain addAll can refill a brand
  // new cache with the SAME stale copies it was created to replace, and the app
  // keeps serving an old build long after one was published.
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetched = fetch(event.request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(event.request, clone));
          }
          return res;
        })
        .catch(() => cached);
      // Serve from cache instantly when present, refresh in the background.
      return cached || fetched;
    })
  );
});
