// Service worker: guarda la app para abrirla sin señal y muestra notificaciones.
const CACHE = "ucb-events-v4";
const ARCHIVOS = [
  "./", "index.html", "estilos.css", "datos.js", "ruteo.js", "horario.js", "app.js",
  "manifest.webmanifest", "icono-192.png", "icono-512.png", "horario_ejemplo.ics", "qrcode.js",
  "lib/leaflet.css", "lib/leaflet.js",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Red primero (datos siempre frescos); si no hay señal, usa la copia guardada.
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok && (e.request.url.startsWith(self.location.origin) || e.request.url.includes("tile.openstreetmap.org"))) {
        const copia = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, copia));
      }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

// Al tocar la notificación, abre la ruta al evento
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil(self.clients.openWindow(url));
});
