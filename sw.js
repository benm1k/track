// Offline support for Track.
// Everything is served from the cache first (so it opens instantly with no signal) and refreshed
// in the background. When the page that comes in is newer than the one served, the app is told,
// and it switches over at a quiet moment (see "updates" in index.html).

const CACHE = 'track-v16';
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

// Keeps a freshly fetched page for next time, and tells the open app when it differs from the
// one it runs. A failed write (e.g. a full phone) never affects what the page receives.
function keepPage(res) {
  if (!res || !res.ok || res.redirected || !(res.headers.get('content-type') || '').includes('text/html')) return;
  const copy = res.clone();
  const fresh = res.clone().text();
  return caches.open(CACHE).then(async cache => {
    const before = await cache.match(INDEX);
    const was = before ? await before.text() : null;
    await cache.put(INDEX, copy);
    if (was !== null && was !== await fresh) await tellPages();
  });
}

// The page is always re-checked with the server ('no-cache'); otherwise the browser's own
// HTTP cache can keep handing back an old copy and an update never arrives.
const fetchPage = () => fetch(self.registration.scope, { cache: 'no-cache' });

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

  const network = (shell ? fetchPage() : fetch(req)).catch(() => null);

  // Refresh the cache in the background.
  event.waitUntil(network.then(res => {
    if (shell) return keepPage(res);
    if (!res || !res.ok) return;
    const copy = res.clone();
    return caches.open(CACHE).then(cache => cache.put(key, copy));
  }).catch(() => {}));

  event.respondWith(
    caches.open(CACHE).then(cache => cache.match(key))
      .then(cached => cached || network)
      .then(res => res || Response.error()),
  );
});

// A short fingerprint of the app's code: the inline script, as both the page and this file
// see it. Kept in step with fingerprint() in index.html.
const fingerprint = text => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `${(h >>> 0).toString(36)}:${text.length}`;
};
const codeOf = html => {
  const a = html.indexOf('<script>');
  const b = html.lastIndexOf('</script>');
  return a < 0 || b < a ? '' : fingerprint(html.slice(a + 8, b).replace(/\r\n?/g, '\n'));
};

// The app asks when it comes back from the background, with the fingerprint of the code it
// runs. A phone can keep it open for days, and without a visit to the page nothing would
// notice an update (or a fresh start) in that time. The page is fetched fresh, and if what we
// now hold isn't what the app runs, it's told to switch, even when the copy came in earlier.
self.addEventListener('message', event => {
  if (!event.data || event.data.type !== 'check') return;
  const app = event.source;
  event.waitUntil(fetchPage().then(keepPage).catch(() => {})
    .then(() => caches.open(CACHE))
    .then(cache => cache.match(INDEX))
    .then(res => res && res.text())
    .then(html => {
      if (html && app && event.data.code && codeOf(html) && codeOf(html) !== event.data.code) app.postMessage({ type: 'updated' });
    })
    .catch(() => {}));
});
