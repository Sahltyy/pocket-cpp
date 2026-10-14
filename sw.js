// Pocket C++ service worker: keeps the app itself available offline.
// The compiler files (*.gz.wasm) are cached by the app, not here.
const VERSION = '12997e3295';
const SHELL = 'pocket-shell-' + VERSION;
const FILES = [
  "./",
  "index.html",
  "editor.js",
  "compiler-worker.js",
  "runner-worker.js",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
  "apple-touch-icon.png",
  "favicon-32.png",
  "licenses.txt",
  "fonts/martian-mono.woff2",
  "fonts/overpass-400.woff2",
  "fonts/overpass-600.woff2",
  "fonts/overpass-700.woff2",
  "fonts/overpass-800.woff2",
  "fonts/ubuntu-mono-400.woff2",
  "fonts/ubuntu-mono-700.woff2"
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(FILES)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.startsWith('pocket-shell-') && k !== SHELL)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('.gz.wasm')) return;
  event.respondWith((async () => {
    const cache = await caches.open(SHELL);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch (err) {
      if (req.mode === 'navigate') {
        const page = await cache.match('./');
        if (page) return page;
      }
      throw err;
    }
  })());
});
