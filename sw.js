// Offline support for Track.
// Everything is served from the cache first (so it opens instantly with no signal)
// and refreshed in the background, so a new version shows up on the next launch.

const CACHE = 'track-v5';
const INDEX = './'; // some hosts redirect /index.html to /, and redirected responses can't serve a page
const SHELL = [
  INDEX,
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './art/arms.png',
  './art/back.png',
  './art/cardio.png',
  './art/chest.png',
  './art/core.png',
  './art/day-1.png',
  './art/day-2.png',
  './art/day-3.png',
  './art/day-4.png',
  './art/day-5.png',
  './art/legs.png',
  './art/other.png',
  './art/shoulders.png',
  './art/welcome.png',
  './art/arms-row.png',
  './art/back-row.png',
  './art/cardio-row.png',
  './art/chest-row.png',
  './art/core-row.png',
  './art/legs-row.png',
  './art/other-row.png',
  './art/shoulders-row.png',
];
const SHELL_URLS = new Set(SHELL.map(u => new URL(u, self.location).href));
const FONT_HOSTS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];

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
      .then(keys => Promise.all(keys.filter(k => k.startsWith('track-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !FONT_HOSTS.includes(url.origin)) return;

  // Only a visit to the app itself is served from the cached page. Opening e.g. the
  // manifest or an icon in a tab must show that file and never replace the page.
  const scope = new URL(self.registration.scope).pathname;
  const shell = req.mode === 'navigate' && (url.pathname === scope || url.pathname === `${scope}index.html`);
  // Same-origin: only the app's own files are cached (not backups or anything else).
  if (sameOrigin && !shell && !SHELL_URLS.has(url.origin + url.pathname)) return;
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
    return caches.open(CACHE).then(cache => cache.put(key, copy));
  }).catch(() => {}));

  event.respondWith(
    caches.open(CACHE).then(cache => cache.match(key))
      .then(cached => cached || network)
      .then(res => res || Response.error()),
  );
});
