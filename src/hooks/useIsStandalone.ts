import { useState, useEffect } from 'react';

/**
 * Checks if the web app is running in standalone PWA mode.
 * Supports iOS Safari (navigator.standalone) and standard CSS media queries
 * (display-mode: standalone | fullscreen | minimal-ui).
 */
export function getIsStandalone(): boolean {
  if (typeof window === 'undefined') return false;

  // iOS Safari specific API
  if (
    'standalone' in window.navigator &&
    Boolean((window.navigator as unknown as { standalone?: boolean }).standalone)
  ) {
    return true;
  }

  // Standard matchMedia for Chromium, Android, and newer Safari WebKit
  if (typeof window.matchMedia === 'function') {
    if (window.matchMedia('(display-mode: standalone)').matches) {
      return true;
    }
    if (window.matchMedia('(display-mode: fullscreen)').matches) {
      return true;
    }
    if (window.matchMedia('(display-mode: minimal-ui)').matches) {
      return true;
    }
  }

  return false;
}

/**
 * Detects whether the current device is an iOS or iPadOS device.
 */
export function getIsIosDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;

  const ua = navigator.userAgent || '';
  const isIos = /iPad|iPhone|iPod/.test(ua);
  const isMacTouch = /Macintosh/.test(ua) && Boolean(navigator.maxTouchPoints && navigator.maxTouchPoints > 1);

  return isIos || isMacTouch;
}

/**
 * React hook to observe standalone state dynamically.
 */
export function useIsStandalone(): boolean {
  const [isStandalone, setIsStandalone] = useState<boolean>(() => getIsStandalone());

  useEffect(() => {
    const update = () => setIsStandalone(getIsStandalone());

    if (typeof window.matchMedia === 'function') {
      const mql = window.matchMedia('(display-mode: standalone)');
      if (mql.addEventListener) {
        mql.addEventListener('change', update);
        return () => mql.removeEventListener('change', update);
      }
    }
  }, []);

  return isStandalone;
}
