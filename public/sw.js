// sw.js — Service Worker for Web Push notifications
// Lives in public/ so it is served at /sw.js (root scope)

const APP_VERSION = 'v1';

// ── Push event ────────────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Chatroom', body: event.data.text(), url: '/' };
  }

  const { title = 'Chatroom', body = 'New message', url = '/' } = payload;

  event.waitUntil(
    // Check if any chat tab is currently focused — skip notification if so
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        const focused = clients.some((c) => c.focused);
        if (focused) return; // Tab is open and focused, skip the notification

        return self.registration.showNotification(title, {
          body,
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          tag: url, // group by destination so only the latest shows
          renotify: true,
          data: { url },
          vibrate: [200, 100, 200],
        });
      })
  );
});

// ── Notification click ────────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';
  const fullUrl = self.location.origin + targetUrl;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        // Try to focus an existing window and navigate it
        for (const client of clients) {
          if ('focus' in client) {
            client.focus();
            if ('navigate' in client) client.navigate(fullUrl);
            return;
          }
        }
        // No existing window — open a new one
        return self.clients.openWindow(fullUrl);
      })
  );
});

// ── Install / Activate ────────────────────────────────────────────────────────
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
