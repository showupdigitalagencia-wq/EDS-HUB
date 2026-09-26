// =============================================================================
// Service Worker Registration & PWA Lifecycle Management
// =============================================================================
// Safely registers the production service worker without prompting for
// notification permissions. Detects updates and dispatches 'eds-pwa-update-available'.
// =============================================================================

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    });

    const notifyUpdateAvailable = (reg: ServiceWorkerRegistration) => {
      window.dispatchEvent(
        new CustomEvent('eds-pwa-update-available', {
          detail: { registration: reg },
        })
      );
    };

    // 1. If a worker is already waiting in the background, alert the UI
    if (registration.waiting) {
      notifyUpdateAvailable(registration);
    }

    // 2. Listen for newly discovered updates
    registration.addEventListener('updatefound', () => {
      const installingWorker = registration.installing;
      if (installingWorker) {
        installingWorker.addEventListener('statechange', () => {
          if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
            console.log('[PWA] New version installed and waiting for activation.');
            notifyUpdateAvailable(registration);
          }
        });
      }
    });

    // 3. Periodically check for updates (every 20 minutes)
    setInterval(() => {
      registration.update().catch((err) => {
        console.debug('[PWA] Periodic update check non-fatal error:', err);
      });
    }, 20 * 60 * 1000);

    // 4. Also check for updates when window gains focus or device goes online
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        registration.update().catch(() => {});
      }
    });

    window.addEventListener('online', () => {
      registration.update().catch(() => {});
    });

    return registration;
  } catch (err) {
    console.warn('[PWA] Service worker registration failed (non-fatal):', err);
    return null;
  }
}
