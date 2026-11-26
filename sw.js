// Network first for the app's own files (so a new deploy shows up at once), cache as fallback offline.
// Google requests are never cached.
// other apps can live on the same domain (e.g. USERNAME.github.io/another-app/): only this app's caches are ever deleted
const CACHE = "spese-v16";
const SHELL = ["./", "index.html", "styles.css", "art.js", "app.js", "lib/exceljs.min.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "Versioni.txt", "guida.txt", "guide.txt"];
self.addEventListener("install", e => {
  // cache each file on its own: one missing file must not stop the app from installing
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("spese-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  // if the host answers with an error page (for example a paused site), keep using the saved copy
  const fromCache = () => caches.match(e.request, { ignoreSearch: true }).then(r => r || (e.request.mode === "navigate" ? caches.match("index.html") : undefined));
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }
    return fromCache().then(c => c || r);
  }).catch(() => fromCache().then(c => c || Response.error())));
});
