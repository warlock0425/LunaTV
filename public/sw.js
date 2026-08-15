/**
 * LunaTV Service Worker
 *
 * 策略：
 * - 只快取同源的不可變靜態資源（/_next/static 帶內容雜湊）與圖示、字型。
 * - /api/*、影音串流（m3u8/ts）一律走網路，避免使用者資料或播放內容
 *   被快取造成錯亂。
 * - 頁面導覽走網路，失敗時回退到預快取的離線頁。
 * - activate 時清除所有非本版快取（包含舊 next-pwa/workbox 時代的殘留）。
 */
const STATIC_CACHE = 'lunatv-static-v1';
const OWNED_CACHES = new Set([STATIC_CACHE]);
const OFFLINE_URL = '/offline.html';
const PRECACHE_URLS = [OFFLINE_URL, '/logo.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await cache.addAll(PRECACHE_URLS);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => !OWNED_CACHES.has(name))
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // 頁面導覽：走網路，斷線時回退離線頁
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cache = await caches.open(STATIC_CACHE);
          const offline = await cache.match(OFFLINE_URL);
          return (
            offline ||
            new Response('離線中', {
              status: 503,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            })
          );
        }
      })()
    );
    return;
  }

  const isImmutableAsset = url.pathname.startsWith('/_next/static/');
  const isStaticFile = /\.(png|ico|svg|woff2?)$/i.test(url.pathname);
  if (!isImmutableAsset && !isStaticFile) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') {
        cache.put(request, response.clone());
      }
      return response;
    })()
  );
});
