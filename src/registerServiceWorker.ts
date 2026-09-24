// =============================================================================
// Service Worker Registration (PWA & Web Push)
// =============================================================================
// Safely registers the production service worker without prompting for
// notification permissions. Permissions are strictly opt-in via user interaction.
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

    // Check for updates periodically
    registration.addEventListener('updatefound', () => {
      const installingWorker = registration.installing;
      if (installingWorker) {
        installingWorker.addEventListener('statechange', () => {
          if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
            console.log('[PWA] New content is available; will update on next reload.');
          }
        });
      }
    });

    return registration;
  } catch (err) {
    console.warn('[PWA] Service worker registration failed (non-fatal):', err);
    return null;
  }
}
