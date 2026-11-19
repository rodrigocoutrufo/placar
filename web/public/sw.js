/* Vyra — service worker.
 * - app (HTML/CSS/JS): rede primeiro, com cópia para abrir sem internet;
 * - /api: rede primeiro; sem conexão, devolve o último dado salvo.
 * Imagens de outros domínios (escudos, fotos) ficam com o cache normal do navegador: a política de
 * segurança (CSP connect-src 'self') não deixa o service worker buscá-las. */
const VERSION = 'placar-v33'; // prefixo antigo mantido: só o número sobe
const APP = `${VERSION}-app`;
const DATA = `${VERSION}-data`;
const MAX_DATA = 150;

// toque na notificação (gol, fim de jogo, NBA, F1): abre ou foca o site na partida
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const w = list.find((c) => new URL(c.url).origin === self.location.origin);
    if (w) { w.navigate(url).catch(() => {}); return w.focus(); }
    return self.clients.openWindow(url);
  }));
});

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icons/icon-192.png'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function trim(name, max) {
  const c = await caches.open(name);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

async function networkFirst(req, cacheName, max) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) { cache.put(req, res.clone()); if (max) trim(cacheName, max); }
    return res;
  } catch (err) {
    const hit = await cache.match(req) || (req.mode === 'navigate' ? await cache.match('/') : null);
    if (hit) return hit;
    if (req.url.includes('/api/')) {
      return new Response(JSON.stringify({ message: 'Sem conexão com o servidor (internet fora ou servidor reiniciando).' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    }
    throw err;
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (['/api/_status', '/api/stream', '/healthz'].includes(url.pathname)) return; // tempo real e status: sempre direto
    if (/^\/api\/(auth|conta|ia|bolao)\//.test(url.pathname)) return; // conta, IA e bolão (pessoal): nunca ficam em cache
    if (url.pathname.startsWith('/api/')) { e.respondWith(networkFirst(req, DATA, MAX_DATA)); return; }
    e.respondWith(networkFirst(req, APP));
  }
});
