// Service worker mínimo — necessário para o app ser instalável (PWA/TWA).
// Não faz cache agressivo, só garante que o navegador reconheça o app como instalável.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Deixa todas as requisições passarem direto para a rede.
});
