// =============================================================================
// EDS HUB — Production-Safe Service Worker
// =============================================================================
// Responsibilities:
// 1. Web Push Notification Ingestion & Display (Works when closed / background)
// 2. Notification Click & Deep Link Routing
// 3. Platform App Badge Synchronization
// 4. Safe App Shell Management (Zero CRM Data Caching)
// =============================================================================

const CACHE_NAME = 'eds-hub-shell-v8';
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

// --- 1. Installation & Immediate Activation ---
self.addEventListener('install', (event) => {
  // Activate immediately so new push handler takes effect on installed PWA
  self.skipWaiting();

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

// --- 3. Push Event Handling (Canonical Background & Closed-App Delivery) ---
// Guarantees delivery when EDS HUB is closed, backgrounded, or phone is locked.
// Does NOT depend on active React state, open tabs, or client window.
self.addEventListener('push', (event) => {
  console.info('[SW] Web push event received at', new Date().toISOString());

  // Wrap the entire lifecycle in event.waitUntil to guarantee iOS process stays alive
  event.waitUntil(
    (async () => {
      let payload = {
        title: 'Notificação — EDS HUB',
        body: 'Novo alerta operacional recebido.',
        data: { url: '/' },
      };

      if (event.data) {
        try {
          const data = event.data.json();
          const targetDeepLink =
            data.deep_link ||
            data.url ||
            (data.data && (data.data.url || data.data.deep_link)) ||
            '/';
          const eventType =
            data.event_type ||
            (data.data && data.data.eventType) ||
            'eds-crm-alert';
          const eventId =
            data.event_id ||
            (data.data && data.data.eventId) ||
            null;
          const taskId =
            data.task_id ||
            (data.data && (data.data.taskId || data.data.task_id)) ||
            (eventType === 'task_due' ? eventId : null);
          const leadId =
            data.lead_id ||
            (data.data && (data.data.leadId || data.data.lead_id)) ||
            null;
          const uniqueTag = `${eventType}_${eventId || taskId || Date.now()}`;

          payload = {
            title: data.title || payload.title,
            body: data.body || payload.body,
            tag: uniqueTag,
            data: {
              url: targetDeepLink,
              deep_link: targetDeepLink,
              event_type: eventType,
              event_id: eventId,
              task_id: taskId,
              lead_id: leadId,
            },
          };

          // App Badge API support (e.g. unread count on mobile home screen)
          const badgeNum =
            typeof data.badge_count === 'number'
              ? data.badge_count
              : data.data && typeof data.data.badgeCount === 'number'
              ? data.data.badgeCount
              : null;
          if (badgeNum !== null && 'setAppBadge' in navigator) {
            navigator.setAppBadge(badgeNum).catch(() => {});
          }
        } catch (err) {
          console.warn('[SW] Failed to parse push payload as JSON, using text fallback:', err);
          payload.body = event.data.text() || payload.body;
        }
      }

      // Base notification options supported across all browsers including iOS WebKit
      const options = {
        body: payload.body,
        tag: payload.tag,
        data: payload.data,
      };

      // Add icon and badge with fully qualified URLs
      try {
        if (self.location && self.location.origin) {
          options.icon = new URL('/pwa-192x192.png', self.location.origin).href;
          options.badge = new URL('/favicon.png', self.location.origin).href;
        }
      } catch (_urlErr) {
        // Fallback without extra images
      }

      // 1. Display notification unconditionally (independent of any open window)
      try {
        await self.registration.showNotification(payload.title, options);
      } catch (showErr) {
        console.warn('[SW] showNotification with full options failed, falling back to minimal options:', showErr);
        await self.registration.showNotification(payload.title, {
          body: payload.body,
          data: payload.data,
        });
      }

      // 2. Opportunistically notify any active foreground windows (for live UI update)
      // Open clients are completely optional and NEVER gate notification display
      try {
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of clients) {
          client.postMessage({
            type: 'PUSH_NOTIFICATION_RECEIVED',
            title: payload.title,
            body: payload.body,
            data: payload.data,
          });
        }
      } catch (_clientErr) {
        // Safe to ignore when app is closed
      }
    })()
  );
});

// --- 4. Notification Click & Deep Link Navigation ---
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const targetUrl = data.deep_link || data.url || '/';
  const fullTargetUrl = new URL(targetUrl, self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(async (clientList) => {
        // If an existing window client is already open, focus it and tell it to navigate
        for (const client of clientList) {
          if ('focus' in client) {
            await client.focus();
            // 1. Post message to React Router for immediate seamless in-app navigation
            client.postMessage({
              type: 'NAVIGATE_TO_URL',
              url: targetUrl,
              data,
            });
            // 2. Also attempt client.navigate if supported by browser/PWA engine
            if ('navigate' in client && typeof client.navigate === 'function') {
              try {
                await client.navigate(fullTargetUrl);
              } catch (_navErr) {
                // Ignore navigation error as postMessage already handles client navigation
              }
            }
            return;
          }
        }
        // Otherwise open a new window directly at destination
        if (self.clients.openWindow) {
          return self.clients.openWindow(fullTargetUrl);
        }
      })
  );
});
