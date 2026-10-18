/* StatTrackr service worker: web push only. No fetch handler, so pages and caching are untouched. */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'StatTrackr';
  const options = {
    body: data.body || '',
    icon: '/images/stattrackr-icon-192.png?v=20260802',
    badge: '/images/stattrackr-icon-192.png?v=20260802',
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    data: { url: data.url || '/picks' },
  };
  const badge =
    typeof data.badgeCount === 'number' && self.navigator.setAppBadge
      ? self.navigator.setAppBadge(data.badgeCount).catch(() => {})
      : Promise.resolve();
  event.waitUntil(Promise.all([self.registration.showNotification(title, options), badge]));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/picks', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          return client.focus().then(() => ('navigate' in client ? client.navigate(url) : undefined));
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
