const CACHE_PREFIX = 'phone-clinic-shell-';
const BUILD_ID = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_ID}`;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const response = await fetch('/index.html', { cache: 'no-store' });
    if (!response.ok) throw new Error('Unable to cache app shell.');
    const html = await response.clone().text();
    await cache.put('/index.html', response);

    const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map((match) => match[1])
      .filter((url) => url.startsWith('/assets/'));
    await Promise.all(assets.map(async (url) => {
      try {
        const assetResponse = await fetch(url, { cache: 'no-store' });
        if (assetResponse.ok) await cache.put(url, assetResponse);
      } catch {
        // The online app shell remains usable even if one optional static asset cannot be cached.
      }
    }));

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    const hasPreviousBuild = cacheNames.some((name) =>
      name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME
    );
    await Promise.all(cacheNames
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (hasPreviousBuild) {
      clients.forEach((client) => client.postMessage({ type: 'APP_UPDATED' }));
    }
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin ||
      url.pathname.startsWith('/api/') || request.destination === 'audio' ||
      /\.(?:mp3|m4a|aac|ogg|wav)(?:$|\?)/i.test(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(request, { cache: 'no-store' });
      } catch {
        return (await caches.match('/index.html')) || Response.error();
      }
    })());
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      return fetch(request);
    })());
  }
});
