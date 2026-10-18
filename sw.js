// Offline support for Track.
// Everything is served from the cache first (so it opens instantly with no signal) and refreshed
// in the background. When the page that comes in is newer than the one served, the app is told,
// and it switches over at a quiet moment (see "updates" in index.html).

const CACHE = 'track-v15';
const INDEX = './'; // some hosts redirect /index.html to /, and redirected responses can't serve a page
const SHELL = [
  INDEX,
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './fonts/jetbrains-mono-latin.woff2',
  './fonts/jetbrains-mono-latin-ext.woff2',
];
const SHELL_URLS = new Set(SHELL.map(u => new URL(u, self.location).href));

const tellPages = () => self.clients.matchAll({ type: 'window' })
  .then(pages => pages.forEach(p => p.postMessage({ type: 'updated' })));

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))) // skip the HTTP cache
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => {
        const old = keys.filter(k => k.startsWith('track-') && k !== CACHE);
        // A new version of this file replaced an old one: the open app is now out of date.
        return Promise.all(old.map(k => caches.delete(k))).then(() => old.length > 0);
      })
      .then(updated => self.clients.claim().then(() => updated && tellPages())),
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Only a visit to the app itself is served from the cached page. Opening e.g. the
  // manifest or an icon in a tab must show that file and never replace the page.
  const scope = new URL(self.registration.scope).pathname;
  const shell = req.mode === 'navigate' && (url.pathname === scope || url.pathname === `${scope}index.html`);
  // Only the app's own files are cached (not backups or anything else).
  if (!shell && !SHELL_URLS.has(url.origin + url.pathname)) return;
  const key = shell ? INDEX : req;

  // The page is always re-checked with the server ('no-cache'); otherwise the browser's own
  // HTTP cache can keep handing back an old copy and an update never arrives.
  const network = (shell ? fetch(self.registration.scope, { cache: 'no-cache' }) : fetch(req)).catch(() => null);

  // Refresh the cache in the background. A failed write (e.g. a full phone) never
  // affects what the page receives.
  event.waitUntil(network.then(res => {
    if (!res || !res.ok) return;
    if (shell && (res.redirected || !(res.headers.get('content-type') || '').includes('text/html'))) return;
    const copy = res.clone();
    const fresh = shell ? res.clone().text() : null;
    return caches.open(CACHE).then(async cache => {
      const before = shell ? await cache.match(INDEX) : null;
      const was = before ? await before.text() : null;
      await cache.put(key, copy);
      if (was !== null && was !== await fresh) await tellPages();
    });
  }).catch(() => {}));

  event.respondWith(
    caches.open(CACHE).then(cache => cache.match(key))
      .then(cached => cached || network)
      .then(res => res || Response.error()),
  );
});
