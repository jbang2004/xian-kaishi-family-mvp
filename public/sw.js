self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

// Intentionally no fetch handler: family pages and child-related data are never
// copied into an offline cache. The open app continues from localStorage instead.
