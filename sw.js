// Service worker com cache do "esqueleto" do app (telas, estilos, código)
// para permitir abrir o app mesmo sem internet, depois da primeira visita online.
//
// Importante: ao publicar uma mudança grande no visual do app, pode valer a pena
// trocar o número da versão abaixo (v1 -> v2) para forçar os aparelhos a
// buscarem os arquivos novos em vez de usar a cópia antiga guardada.
const CACHE_NAME = "emulti-cache-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Só cuida de pedidos GET do próprio site (telas, scripts, imagens).
  // Pedidos para o Firebase/Firestore (outro domínio) passam direto,
  // sem guardar em cache aqui — o próprio Firebase cuida do modo offline deles.
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return response;
        })
        .catch(() => cached);

      // Mostra a cópia guardada na hora (mais rápido e funciona offline),
      // e atualiza essa cópia em segundo plano sempre que há internet.
      return cached || networkFetch;
    })
  );
});
