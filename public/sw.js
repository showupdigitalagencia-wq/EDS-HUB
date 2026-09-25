// =============================================================================
// EDS HUB — Production-Safe Service Worker
// =============================================================================
// Responsibilities:
// 1. Web Push Notification Ingestion & Display
// 2. Notification Click & Deep Link Routing
// 3. Platform App Badge Synchronization
// 4. Safe App Shell Management (Zero CRM Data Caching)
// =============================================================================

const CACHE_NAME = 'eds-hub-shell-v5';
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

// Allow client app to trigger instant safe activation without waiting
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
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
  console.info('[SW] Web push event received at', new Date().toISOString());

  let payload = {
    title: 'Teste de notificação — EDS HUB',
    body: 'Se você recebeu este alerta, as notificações estão funcionando neste dispositivo.',
    icon: '/pwa-192x192.png',
    badge: '/favicon.png',
    data: { url: '/' },
  };

  if (event.data) {
    try {
      const data = event.data.json();
      const targetDeepLink = data.deep_link || data.url || (data.data && (data.data.url || data.data.deep_link)) || '/';
      const eventType = data.event_type || (data.data && data.data.eventType) || 'eds-crm-alert';
      const eventId = data.event_id || (data.data && data.data.eventId) || null;

      payload = {
        title: data.title || payload.title,
        body: data.body || payload.body,
        icon: data.icon || '/pwa-192x192.png',
        badge: data.badge || '/favicon.png',
        tag: eventType,
        data: {
          url: targetDeepLink,
          event_type: eventType,
          event_id: eventId,
        },
      };

      // App Badge API support (e.g. unread count on mobile home screen)
      const badgeNum = typeof data.badge_count === 'number'
        ? data.badge_count
        : (data.data && typeof data.data.badgeCount === 'number' ? data.data.badgeCount : null);
      if (badgeNum !== null && 'setAppBadge' in navigator) {
        navigator.setAppBadge(badgeNum).catch(() => {});
      }
    } catch (err) {
      console.warn('[SW] Failed to parse push payload as JSON, using text fallback:', err);
      payload.body = event.data.text();
    }
  }

  // Notify any active foreground windows of the push event (for diagnostic UI)
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    for (const client of clients) {
      client.postMessage({
        type: 'PUSH_NOTIFICATION_RECEIVED',
        title: payload.title,
        body: payload.body,
        data: payload.data,
      });
    }
  }).catch(() => {});

  // Construct options safely for iOS and cross-browser support
  const fullOptions = {
    body: payload.body,
    data: payload.data,
  };

  if (payload.icon) fullOptions.icon = payload.icon;
  if (payload.badge) fullOptions.badge = payload.badge;
  if (payload.tag) {
    fullOptions.tag = payload.tag;
    fullOptions.renotify = true;
  }

  // Critical for iOS Safari: Call showNotification within event.waitUntil with minimal fallback
  const displayPromise = self.registration.showNotification(payload.title, fullOptions)
    .catch((err) => {
      console.warn('[SW] showNotification with full options failed, falling back to minimal options:', err);
      return self.registration.showNotification(payload.title, {
        body: payload.body,
        data: payload.data,
      });
    });

  event.waitUntil(displayPromise);
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
