/* eslint-env serviceworker */
/* global clients */
// Service Worker for QueueUp Push Notifications
// NOTE: This is the SOURCE file. It is copied to public/sw.js during build.
// Edit this file (docs/sw.js), not public/sw.js.

// Take control of the page immediately after first install so push setup can continue.
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let data = {};
  try { data = event.data.json(); } catch { return; }
  const notificationData = {
    url: data.url || '/',
    kind: data.kind || null,
  };
  event.waitUntil(self.registration.showNotification(data.title || 'QueueUp', {
    body: data.body,
    data: notificationData,
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification?.data?.url || '/';
  const kind = event.notification?.data?.kind || null;
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = all.find((c) => new URL(c.url).origin === location.origin);
    if (existing) {
      await existing.focus();
      try { existing.postMessage({ type: 'notif-open' }); } catch {}
    } else {
      await clients.openWindow(url);
    }
    try {
      await fetch('/api/track', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'notif_click', meta: { kind } }),
      });
    } catch {}
    if (kind === 'pos_2' || kind === 'pos_5') {
      try {
        await fetch('/api/track', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'nudge_ack', meta: { source: 'notification_click', kind } }),
        });
      } catch {}
    }
  })());
});
