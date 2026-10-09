// minicontrol's service worker: what makes the page installable, and lets it open
// without a connection once it has been visited.
//
// Network first, cache as the fallback. Every visit online gets whatever was last
// deployed, so a fix never waits behind a stale copy; offline, the page opens from
// what the last visit saw. The minichord itself is reached over USB MIDI, which
// needs no network at all.

const CACHE = 'minicontrol-v1';

// the page and what it needs to start; everything else it fetches is kept as it goes
const SHELL = [
  './',
  'index.html',
  'index.css',
  'index.js',
  'banks.js',
  'describe.js',
  'commands.js',
  'describe_data.json',
  'minichordcontroller.js',
  'parameters.json',
  'minichord_layout_web.svg',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'themes/fonts.css',
  'themes/common.css',
  'themes/arcade.css',
  'themes/omnichord.css',
  'themes/notebook.css',
  'themes/choir.css',
  'themes/chiptune.css',
  'themes/contrast.css',
  'themes/stage.css',
];

self.addEventListener('install', event => {
  // one at a time, so a single missing file can't stop the rest being kept
  event.waitUntil(caches.open(CACHE).then(cache =>
    Promise.all(SHELL.map(url => cache.add(url).catch(() => {})))));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(request, copy));
      }
      return response;
    }).catch(() => caches.match(request, { ignoreSearch: true })
      .then(hit => hit || (request.mode === 'navigate' ? caches.match('index.html') : undefined))
      .then(hit => hit || Response.error()))
  );
});
