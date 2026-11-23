// Service Worker for Mobile Top-Up PWA
// Version 1.0.0

// Cache version: bump this on every deploy. Cache names are derived
// from it, so a new deploy's worker activates with fresh caches and
// the activate handler below retires the previous deploy's caches.
const SW_VERSION = 'v2';

const CACHE_NAME = `mobile-topup-${SW_VERSION}`;
const RUNTIME_CACHE = `mobile-topup-runtime-${SW_VERSION}`;

// Authenticated areas. Their HTML must never enter the runtime cache
// (F-M9): a cached dashboard/portal page could otherwise be re-served
// after sign-out, or to the next user of a shared browser. Navigations
// to these prefixes are network-only and are never read back from
// cache either.
const AUTHENTICATED_PATH_PREFIXES = [
  '/dashboard',
  '/customer-portal',
  '/staff-portal',
];

function isAuthenticatedPath(pathname) {
  return AUTHENTICATED_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

// Assets to cache on install
const PRECACHE_ASSETS = [
  '/',
  '/login',
  '/signup',
  '/offline',
];

// Install event - cache essential assets
self.addEventListener('install', (event) => {
  console.log('[ServiceWorker] Install event');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[ServiceWorker] Pre-caching app shell');
      return cache.addAll(PRECACHE_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[ServiceWorker] Activate event');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName !== RUNTIME_CACHE) {
            console.log('[ServiceWorker] Removing old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip cross-origin requests
  if (url.origin !== location.origin) {
    return;
  }

  // Skip API requests from caching (always fetch fresh)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() => {
        return new Response(
          JSON.stringify({ error: 'Network error, please check your connection' }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      })
    );
    return;
  }

  // For navigation requests to authenticated areas: network-only,
  // never cached and never served from cache (F-M9). On network
  // failure, fall back straight to the offline page.
  if (request.mode === 'navigate' && isAuthenticatedPath(url.pathname)) {
    event.respondWith(
      fetch(request).catch(() => {
        return caches.match('/offline');
      })
    );
    return;
  }

  // For navigation requests
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Clone the response and cache it
          const responseToCache = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => {
            cache.put(request, responseToCache);
          });
          return response;
        })
        .catch(() => {
          // If offline, try cache first
          return caches.match(request).then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // If no cache, show offline page
            return caches.match('/offline');
          });
        })
    );
    return;
  }

  // For other requests (images, styles, scripts)
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request)
        .then((response) => {
          // Don't cache non-successful responses
          if (!response || response.status !== 200 || response.type === 'error') {
            return response;
          }

          const responseToCache = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => {
            cache.put(request, responseToCache);
          });

          return response;
        })
        .catch(() => {
          // For images, return a placeholder if offline
          if (request.destination === 'image') {
            return new Response(
              '<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" fill="#cccccc"/></svg>',
              { headers: { 'Content-Type': 'image/svg+xml' } }
            );
          }
        });
    })
  );
});

// Handle background sync (for future implementation)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-transactions') {
    console.log('[ServiceWorker] Background sync: transactions');
    // Future: sync pending transactions when back online
  }
});

// Handle push notifications (for future implementation)
self.addEventListener('push', (event) => {
  console.log('[ServiceWorker] Push notification received');
  const options = {
    body: event.data ? event.data.text() : 'New update available',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1,
    },
  };

  event.waitUntil(
    self.registration.showNotification('Mobile Top-Up', options)
  );
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  console.log('[ServiceWorker] Notification clicked');
  event.notification.close();
  event.waitUntil(
    clients.openWindow('/')
  );
});
