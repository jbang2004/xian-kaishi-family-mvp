self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

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

// Intentionally no fetch handler: family pages and child-related data are never
// copied into an offline cache. The open app continues from localStorage instead.
