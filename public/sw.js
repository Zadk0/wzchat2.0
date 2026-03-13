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
