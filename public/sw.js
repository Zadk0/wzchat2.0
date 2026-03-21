self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  return self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Pass-through fetch handler to satisfy PWA requirements
  e.respondWith(
    fetch(e.request).catch(() => {
      return new Response('Offline - Conéctate a internet para usar WZChat.');
    })
  );
});

self.addEventListener('push', function(event) {
  if (event.data) {
    const data = event.data.json();
    const options = {
      body: data.body,
      icon: data.icon || '/vite.svg',
      badge: '/vite.svg',
      vibrate: [100, 50, 100],
      data: data.data
    };
    
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
        let isFocused = false;
        for (let i = 0; i < clientList.length; i++) {
          const client = clientList[i];
          if (client.focused) {
            isFocused = true;
            break;
          }
        }
        
        if (!isFocused) {
          return self.registration.showNotification(data.title, options);
        }
      })
    );
  }
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      const urlToOpen = new URL(event.notification.data.url || '/', self.location.origin).href;
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
