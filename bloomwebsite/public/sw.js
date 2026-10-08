self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let p = {};
  try {
    p = event.data ? event.data.json() : {};
  } catch {
    p = { title: "Теплица", body: event.data ? event.data.text() : "" };
  }

  event.waitUntil(
    (async () => {
      // сообщаем открытому приложению, чтобы оно сразу обновило колокольчик
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      clients.forEach((c) => c.postMessage({ type: "push-received" }));

      await self.registration.showNotification(p.title || "Теплица", {
        body: p.body || "",
        tag: p.tag,        // тот же tag заменяет прошлое уведомление (тревога -> «в норме»)
        renotify: true,
        icon: "/icons/icon-192.png",
        badge: "/icons/badge-72.png",
        requireInteraction: p.severity === "critical",
        data: p.data || {},
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const id = event.notification.data && event.notification.data.notification_id;
  const url = id ? `/?notification=${id}` : "/";

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of clients) {
        if ("focus" in c) {
          await c.focus();
          c.postMessage({ type: "open-notifications" });
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});