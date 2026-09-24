// =============================================================================
// EDS HUB — Production-Safe Service Worker
// =============================================================================
// Responsibilities:
// 1. Web Push Notification Ingestion & Display
// 2. Notification Click & Deep Link Routing
// 3. Platform App Badge Synchronization
// 4. Safe App Shell Management (Zero CRM Data Caching)
// =============================================================================

const CACHE_NAME = 'eds-hub-shell-v2';
const SHELL_ASSETS = [
  '/',
  '/manifest.webmanifest',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/pwa-maskable-192x192.png',
  '/pwa-maskable-512x512.png',
  '/apple-touch-icon.png',
  '/favicon.png',
];

// --- 1. Installation & Activation ---
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(SHELL_ASSETS).catch((err) => {
        console.warn('[SW] Cache addAll non-fatal error:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// --- 2. Network Fetch Strategy ---
// Rule: Do NOT aggressively cache CRM API/data responses.
// Supabase queries, RPCs, and Edge Functions always bypass cache.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Bypass cache completely for Supabase API, Edge Functions, and non-GET requests
  if (
    event.request.method !== 'GET' ||
    url.hostname.includes('supabase.co') ||
    url.pathname.startsWith('/functions/v1') ||
    url.pathname.startsWith('/rest/v1') ||
    url.pathname.startsWith('/auth/v1')
  ) {
    return; // Standard network fetch
  }

  // Network-first with cache fallback for static app shell
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache valid static responses
        if (response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// --- 3. Push Event Handling ---
self.addEventListener('push', (event) => {
  let payload = {
    title: 'EDS HUB Alerta',
    body: 'Você possui uma nova notificação operacional.',
    icon: '/pwa-192x192.png',
    badge: '/favicon.png',
    data: { url: '/' },
  };

  if (event.data) {
    try {
      const data = event.data.json();
      payload = {
        title: data.title || payload.title,
        body: data.body || payload.body,
        icon: data.icon || '/pwa-192x192.png',
        badge: data.badge || '/favicon.png',
        tag: data.event_type || 'eds-crm-alert',
        data: {
          url: data.deep_link || data.url || '/',
          event_type: data.event_type,
          event_id: data.event_id,
        },
      };

      // App Badge API support (e.g. unread count on mobile home screen)
      if (typeof data.badge_count === 'number' && 'setAppBadge' in navigator) {
        navigator.setAppBadge(data.badge_count).catch(() => {});
      }
    } catch (err) {
      console.warn('[SW] Failed to parse push payload as JSON, using text fallback:', err);
      payload.body = event.data.text();
    }
  }

  const notificationOptions = {
    body: payload.body,
    icon: payload.icon,
    badge: payload.badge,
    data: payload.data,
    tag: payload.tag,
    vibrate: [100, 50, 100],
    renotify: true,
  };

  event.waitUntil(
    self.registration.showNotification(payload.title, notificationOptions)
  );
});

// --- 4. Notification Click & Deep Link Navigation ---
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  const fullTargetUrl = new URL(targetUrl, self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // If an existing window client is already open, focus it and navigate
        for (const client of clientList) {
          if ('focus' in client) {
            client.focus();
            if ('navigate' in client) {
              return client.navigate(fullTargetUrl);
            }
            return;
          }
        }
        // Otherwise open a new window
        if (self.clients.openWindow) {
          return self.clients.openWindow(fullTargetUrl);
        }
      })
  );
});
