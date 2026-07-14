const CACHE_PREFIX = "xian-kaishi-shell-";
const CACHE_NAME = `${CACHE_PREFIX}v2`;
const OFFLINE_ASSET_MANIFEST = "/offline-assets.json";

function safeStaticUrl(input) {
  const url = new URL(typeof input === "string" ? input : input.url, self.location.origin);
  if (url.origin !== self.location.origin) return null;
  if (url.pathname.startsWith("/api/")) return null;
  if (url.pathname.startsWith("/assets/") || url.pathname === "/manifest.webmanifest" || url.pathname === OFFLINE_ASSET_MANIFEST) return url;
  return null;
}

function staticCacheKey(input) {
  const url = safeStaticUrl(input);
  return url ? `${url.pathname}${url.pathname === OFFLINE_ASSET_MANIFEST ? "" : url.search}` : null;
}

async function cacheStaticResponse(cache, input, response) {
  const key = staticCacheKey(input);
  if (!key || !response?.ok || response.type === "opaque") return;
  await cache.put(key, response);
}

function shellAssetsFromHtml(html) {
  const assets = new Set();
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const url = safeStaticUrl(match[1]);
    if (url) assets.add(`${url.pathname}${url.search}`);
  }
  return [...assets];
}

async function fetchAndCacheStatic(cache, input) {
  try {
    const response = await fetch(input, { cache: "reload" });
    await cacheStaticResponse(cache, input, response.clone());
  } catch { /* one missing optional image must not block the offline shell */ }
}

async function refreshShell() {
  const cache = await caches.open(CACHE_NAME);
  let criticalAssets = [];
  try {
    const manifestResponse = await fetch(OFFLINE_ASSET_MANIFEST, { cache: "reload" });
    if (manifestResponse.ok) {
      const manifest = await manifestResponse.clone().json();
      criticalAssets = Array.isArray(manifest.criticalAssets) ? manifest.criticalAssets.filter(item => typeof item === "string" && safeStaticUrl(item)) : [];
      await cacheStaticResponse(cache, OFFLINE_ASSET_MANIFEST, manifestResponse);
    }
  } catch { /* the HTML shell can still provide the critical JS and CSS list */ }

  let shellAssets = [];
  try {
    const shellResponse = await fetch(new Request("/", { cache: "reload" }));
    if (shellResponse.ok) {
      shellAssets = shellAssetsFromHtml(await shellResponse.clone().text());
      await cache.put("/", shellResponse);
    }
  } catch { /* a previous shell remains available during a failed update */ }

  await Promise.allSettled([
    "/manifest.webmanifest",
    ...new Set([...criticalAssets, ...shellAssets]),
  ].map(asset => fetchAndCacheStatic(cache, asset)));
}

self.addEventListener("install", event => {
  event.waitUntil(refreshShell().finally(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok && response.headers.get("content-type")?.includes("text/html")) {
          const cache = await caches.open(CACHE_NAME);
          const shellAssets = shellAssetsFromHtml(await response.clone().text());
          await cache.put("/", response.clone());
          await Promise.allSettled(shellAssets.map(asset => fetchAndCacheStatic(cache, asset)));
        }
        return response;
      } catch {
        return (await caches.match("/")) || Response.error();
      }
    })());
    return;
  }

  if (!safeStaticUrl(request)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(request);
      if (response.ok) {
        event.waitUntil(cacheStaticResponse(cache, request, response.clone()));
        return response;
      }
    } catch { /* fall through to the last known public asset */ }
    return (await cache.match(request, { ignoreSearch: true })) || Response.error();
  })());
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(windowClients => {
      const existing = windowClients.find(client => client.url.startsWith(self.location.origin));
      if (existing) {
        if ("navigate" in existing && existing.url !== targetUrl) void existing.navigate(targetUrl);
        return existing.focus();
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});

// Family API responses are deliberately bypassed above. Only the public app
// shell and public visual assets enter Cache Storage; family state continues to
// live in localStorage and the no-store /api/state channel.
