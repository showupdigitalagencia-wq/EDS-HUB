// =============================================================================
// EDS HUB — Supabase Client (Frontend)
// =============================================================================
// This client uses the ANON key only. It is safe for browser use.
// Server-side operations use the service_role key inside Edge Functions.
// =============================================================================

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    'Missing Supabase environment variables. ' +
    'Please set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in your .env file.'
  );
}

// Helper to identify transient network failures (WebKit "Load failed", Chromium "Failed to fetch")
export function isTransientNetworkError(error: unknown): boolean {
  if (!error) return false;
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    msg.includes('load failed') ||
    msg.includes('failed to fetch') ||
    msg.includes('network error') ||
    msg.includes('networkerror') ||
    msg.includes('connection closed') ||
    msg.includes('connection refused') ||
    msg.includes('abort') ||
    error instanceof TypeError
  );
}

// Resilient fetch wrapper with automatic retry on transient mobile/WebKit network drops
export const resilientFetch: typeof fetch = async (input, init) => {
  try {
    return await fetch(input, init);
  } catch (err) {
    if (isTransientNetworkError(err)) {
      // 250ms backoff before 1 retry
      await new Promise((resolve) => setTimeout(resolve, 250));
      return await fetch(input, init);
    }
    throw err;
  }
};

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  },
  global: {
    fetch: resilientFetch,
  },
});
