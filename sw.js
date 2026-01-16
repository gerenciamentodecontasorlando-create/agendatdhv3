/* =========================================================
   BTX FLOW • Service Worker (offline-first)
   Cache simples e confiável para PWA estável
   ========================================================= */

const CACHE_NAME = "btx-flow-tdah-v3-cache";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./db.js",
  "./app.js",
  "./pdf.js",
  "./manifest.webmanifest",
  "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => (k !== CACHE_NAME ? caches.delete(k) : null)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Estratégia:
  // - Primeiro cache
  // - Se não tiver, busca na rede e guarda no cache
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;

      return fetch(req).then(res => {
        // só cacheia GET e respostas ok
        if (req.method === "GET" && res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
        }
        return res;
      }).catch(() => {
        // fallback mínimo para navegação
        if (req.mode === "navigate") return caches.match("./index.html");
        return cached;
      });
    })
  );
});
