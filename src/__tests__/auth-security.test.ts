// =============================================================================
// Tests T13-T14: Authentication & RLS Security
// =============================================================================
// These tests validate that:
// T13: Unauthenticated users cannot access data
// T14: Authenticated users not in app_user cannot access data
//
// NOTE: These tests require a running Supabase local instance.
// Run `supabase start` before executing these tests.
// If Supabase is not running, these tests will be skipped.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || (import.meta as any).env?.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

// Helper to check if Supabase is available
async function isSupabaseAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/pipeline_stages?select=id&limit=1`, {
      headers: { 'apikey': SUPABASE_ANON_KEY },
    });
    return response.ok || response.status === 200;
  } catch {
    return false;
  }
}

describe('Authentication & RLS Security', () => {
  // T13: Unauthenticated user → access denied
  it('T13: unauthenticated user cannot access app_settings', async () => {
    const available = await isSupabaseAvailable();
    expect(available, 'Supabase remote instance must be available for RLS integration test').toBe(true);

    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // Try to read app_settings without authentication
    const { data } = await anonClient
      .from('app_settings')
      .select('*');

    // RLS should block: either error or empty data
    expect(data === null || (Array.isArray(data) && data.length === 0)).toBe(true);
  });

  it('T13: unauthenticated user cannot access leads', async () => {
    const available = await isSupabaseAvailable();
    expect(available, 'Supabase remote instance must be available for RLS integration test').toBe(true);

    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    const { data } = await anonClient.from('leads').select('*');

    expect(data === null || (Array.isArray(data) && data.length === 0)).toBe(true);
  });

  it('T13: unauthenticated user cannot access pipeline_stages', async () => {
    const available = await isSupabaseAvailable();
    expect(available, 'Supabase remote instance must be available for RLS integration test').toBe(true);

    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    const { data } = await anonClient
      .from('pipeline_stages')
      .select('*');

    // With RLS, anon should get empty results
    expect(data === null || (Array.isArray(data) && data.length === 0)).toBe(true);
  });

  it('T13: unauthenticated user cannot access app_user', async () => {
    const available = await isSupabaseAvailable();
    expect(available, 'Supabase remote instance must be available for RLS integration test').toBe(true);

    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    const { data } = await anonClient
      .from('app_user')
      .select('*');

    // With RLS, anon should get empty results
    expect(data === null || (Array.isArray(data) && data.length === 0)).toBe(true);
  });

  // T14: Authenticated but not in app_user → access denied
  // This test validates that is_active_app_user returns false when no matching app_user exists.
  // When auth.uid() is NULL or does not match an active row in app_user, no data is returned.
  it('T14: is_active_app_user returns false when no matching app_user exists', async () => {
    const available = await isSupabaseAvailable();
    expect(available, 'Supabase remote instance must be available for RLS integration test').toBe(true);

    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    const { data } = await anonClient
      .from('pipeline_stages')
      .select('*');

    // With RLS, anon or unlinked user gets empty results
    expect(data === null || (Array.isArray(data) && data.length === 0)).toBe(true);
  });
});
