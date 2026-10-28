/// <reference lib="webworker" />
import { clientsClaim } from "workbox-core";
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

declare const self: ServiceWorkerGlobalScope;

// App shell: precached at install, so the app opens without network.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html"), { denylist: [/^\/api\//, /^\/ical\//] }));

self.addEventListener("message", (event) => {
  // Only our own pages may activate a waiting update.
  if (event.origin !== self.location.origin) return;
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
});
clientsClaim();

interface PushData {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

self.addEventListener("push", (event) => {
  const data = (event.data?.json() ?? {}) as Partial<PushData>;
  event.waitUntil(
    (async () => {
      // Open app windows refetch right away, so the change is visible without a tap.
      for (const client of await self.clients.matchAll({ type: "window" })) client.postMessage({ type: "refresh" });
    })(),
  );
  event.waitUntil(
    self.registration.showNotification(data.title ?? "Auto", {
      body: data.body,
      tag: data.tag,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: data.url ?? "/" },
    }),
  );
});

// Opens the matching screen (e.g. the request with its three answers).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? "/";
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const client = windows[0];
      if (client) {
        await client.focus();
        client.postMessage({ type: "navigate", url });
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
