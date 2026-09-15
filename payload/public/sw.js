self.addEventListener('push', (event) => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch (error) {
        data = { title: 'RMC Notice', body: 'New notice received.' };
    }

    const title = data.title || 'RMC Notice';
    const options = {
        body: data.body || 'New notice available in student portal.',
        tag: data.tag || 'rmc-notice',
        icon: '/img/logo.png',
        badge: '/img/logo.png',
        data: { url: data.url || '/student/portal' }
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const targetUrl = event.notification?.data?.url || '/student/portal';
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if ('focus' in client) {
                    client.navigate(targetUrl);
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
            return null;
        })
    );
});
