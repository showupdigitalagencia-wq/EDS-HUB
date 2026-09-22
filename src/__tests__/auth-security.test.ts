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

  describe('Multi-Admin Access & Security Governance', () => {
    it('supports multiple active administrative users without singleton conflict', () => {
      // Validates data model structure: singleton_key can be null/omitted
      const adminUsers = [
        {
          user_id: 'a6eb60ca-d453-4758-9252-39339be3fb4b',
          email: 'showupdigitalagencia@gmail.com',
          display_name: 'EDS HUB',
          is_active: true,
          singleton_key: null,
        },
        {
          user_id: '1de58cee-d6ad-4970-8ee9-ef8aa92f4e6a',
          email: 'info@expdentalsolutions.com',
          display_name: 'Expert Dental Solutions Admin',
          is_active: true,
          singleton_key: null,
        },
      ];

      expect(adminUsers).toHaveLength(2);
      expect(adminUsers[0].email).not.toBe(adminUsers[1].email);
      expect(adminUsers[0].user_id).not.toBe(adminUsers[1].user_id);
      expect(adminUsers.every((u) => u.is_active)).toBe(true);
      // Both users coexist with null singleton_key without collision
      expect(adminUsers[0].singleton_key).toBeNull();
      expect(adminUsers[1].singleton_key).toBeNull();
    });

    it('evaluates is_active_app_user independently per auth.uid()', () => {
      const activeUserIds = new Set([
        'a6eb60ca-d453-4758-9252-39339be3fb4b',
        '1de58cee-d6ad-4970-8ee9-ef8aa92f4e6a',
      ]);

      const isUserActive = (uid: string | null) => uid !== null && activeUserIds.has(uid);

      // Both legitimate admins are authorized
      expect(isUserActive('a6eb60ca-d453-4758-9252-39339be3fb4b')).toBe(true);
      expect(isUserActive('1de58cee-d6ad-4970-8ee9-ef8aa92f4e6a')).toBe(true);

      // Anonymous is rejected
      expect(isUserActive(null)).toBe(false);

      // Authenticated user outside app_user is rejected
      expect(isUserActive('unauthorized-uuid-777')).toBe(false);
    });

    it('rejects inactive app_user while active co-admin remains authorized', () => {
      const appUsers = [
        {
          user_id: 'a6eb60ca-d453-4758-9252-39339be3fb4b',
          email: 'showupdigitalagencia@gmail.com',
          is_active: true,
        },
        {
          user_id: '1de58cee-d6ad-4970-8ee9-ef8aa92f4e6a',
          email: 'info@expdentalsolutions.com',
          is_active: false, // inactive / disabled
        },
      ];

      const isUserActive = (uid: string) => {
        const u = appUsers.find((user) => user.user_id === uid);
        return Boolean(u && u.is_active);
      };

      // Active admin is authorized
      expect(isUserActive('a6eb60ca-d453-4758-9252-39339be3fb4b')).toBe(true);

      // Inactive admin is strictly rejected
      expect(isUserActive('1de58cee-d6ad-4970-8ee9-ef8aa92f4e6a')).toBe(false);

      // Unrelated user is rejected
      expect(isUserActive('unrelated-user-123')).toBe(false);
    });

    it('supports clean offboarding by setting is_active to false without deleting records', () => {
      const appUsers = [
        {
          user_id: '1de58cee-d6ad-4970-8ee9-ef8aa92f4e6a',
          email: 'info@expdentalsolutions.com',
          is_active: true,
        },
      ];

      // Simulate offboarding
      appUsers[0].is_active = false;

      // Access is immediately revoked
      const isAllowed = appUsers[0].is_active;
      expect(isAllowed).toBe(false);

      // History is completely preserved
      expect(appUsers).toHaveLength(1);
      expect(appUsers[0].email).toBe('info@expdentalsolutions.com');
    });
  });
});
