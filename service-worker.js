self.addEventListener('install', function(event) {
  console.log('Service Worker installiert.');
});

self.addEventListener('activate', function(event) {
  console.log('Service Worker aktiviert.');
});

self.addEventListener('fetch', function(event) {
  // Optional: Hier kannst du Caching-Strategien implementieren.
});
