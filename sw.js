/* Coach Trail — service worker.
   Met en cache uniquement les fichiers de l'application (aucune donnée personnelle).
   Pour publier une mise à jour : modifier CACHE_VERSION. L'ancien cache est supprimé à l'activation. */
const CACHE_VERSION = "coach-trail-v1.1.0";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL.map((u) => new Request(u, { cache: "reload" }))))
  );
  // Pas de skipWaiting automatique : l'utilisateur choisit quand appliquer la mise à jour.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("coach-trail-") && k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // aucune ressource externe

  // Navigation : réseau d'abord (pour récupérer la dernière page), cache en secours hors ligne.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then((c) => c.put("./index.html", copy));
        return res;
      }).catch(() => caches.match("./index.html", { ignoreSearch: true }))
    );
    return;
  }
  // Fichiers de l'application : cache d'abord (versionné par CACHE_VERSION), réseau sinon.
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req))
  );
});
