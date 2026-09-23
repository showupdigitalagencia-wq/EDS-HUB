import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Hook providing a defensive back navigation strategy.
 * If browser history has depth, navigates back (-1).
 * Otherwise, safely redirects to the provided fallback route.
 */
export function useSafeBackNavigation(fallbackPath: string) {
  const navigate = useNavigate();

  const handleBack = useCallback(() => {
    // If window.history.length > 2, it's safe to pop state
    if (typeof window !== 'undefined' && window.history && window.history.length > 2) {
      navigate(-1);
    } else {
      navigate(fallbackPath, { replace: true });
    }
  }, [navigate, fallbackPath]);

  return handleBack;
}
