self.addEventListener('install', event => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('push', event => {
    let payload = {};
    try {
        payload = event.data ? event.data.json() : {};
    } catch (error) {
        console.error('La notificación recibida no contiene JSON válido:', error);
    }

    event.waitUntil(self.registration.showNotification(payload.title || 'euNICE', {
        body: payload.body || 'Hay una actualización del sistema.',
        icon: '/icon-192.png?v=6',
        badge: '/icon-192.png?v=6',
        requireInteraction: true,
        vibrate: [200, 100, 200],
        data: { url: payload.url || '/' }
    }));
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const target = new URL(event.notification.data?.url || '/', self.location.origin);
    if (target.origin !== self.location.origin) return;

    event.waitUntil((async () => {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const windowClient of windows) {
            if (new URL(windowClient.url).origin === self.location.origin) {
                await windowClient.navigate(target.href);
                return windowClient.focus();
            }
        }
        return self.clients.openWindow(target.href);
    })());
});
