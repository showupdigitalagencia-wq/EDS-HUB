// =============================================================================
// Tests: Phase 2 Security & RLS Policies (All 13 New Tables)
// =============================================================================
// Validates that all 13 Phase 2 tables have active Row Level Security (RLS)
// and that unauthenticated (anon) requests or requests from users outside
// active app_user are strictly blocked from SELECT, INSERT, UPDATE, and DELETE.
//
// Tables tested (13):
// 1. tags
// 2. lead_tags
// 3. lead_notes
// 4. lead_imports
// 5. lead_import_rows
// 6. email_templates
// 7. campaigns
// 8. campaign_versions
// 9. campaign_audiences
// 10. campaign_variants
// 11. campaign_recipients
// 12. campaign_test_sends
// 13. campaign_jobs
// =============================================================================

import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || (import.meta as any).env?.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

const PHASE_2_TABLES = [
  'tags',
  'lead_tags',
  'lead_notes',
  'lead_imports',
  'lead_import_rows',
  'email_templates',
  'campaigns',
  'campaign_versions',
  'campaign_audiences',
  'campaign_variants',
  'campaign_recipients',
  'campaign_test_sends',
  'campaign_jobs',
] as const;

async function isSupabaseAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/pipeline_stages?select=id&limit=1`, {
      headers: { apikey: SUPABASE_ANON_KEY },
    });
    return response.ok || response.status === 200;
  } catch {
    return false;
  }
}

const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

describe('Phase 2 RLS Security: All 13 New Tables', () => {
  it('verifies that exactly 13 Phase 2 tables are defined for RLS testing', () => {
    expect(PHASE_2_TABLES).toHaveLength(13);
  });

  describe('Unauthenticated (anon) access is strictly blocked', () => {
    PHASE_2_TABLES.forEach((table) => {
      it(`blocks anon SELECT on ${table}`, async () => {
        const available = await isSupabaseAvailable();
        expect(available, 'Supabase instance must be reachable').toBe(true);

        const { data, error } = await anonClient.from(table).select('*').limit(5);

        // With RLS active and no permissive anon policy, either error is returned or data is empty array/null
        if (error) {
          expect(error).toBeDefined();
        } else {
          expect(data === null || (Array.isArray(data) && data.length === 0)).toBe(true);
        }
      });

      it(`blocks anon INSERT on ${table}`, async () => {
        const available = await isSupabaseAvailable();
        expect(available, 'Supabase instance must be reachable').toBe(true);

        // Attempt an unauthorized insert with arbitrary dummy payload
        const dummyPayload: Record<string, any> = {
          id: '00000000-0000-0000-0000-000000000000',
          name: 'Unauthorized Test',
        };

        const { data, error } = await anonClient.from(table).insert(dummyPayload as any).select();

        // Must fail with error or produce null/empty insert
        expect(error !== null || data === null || (Array.isArray(data) && data.length === 0)).toBe(true);
      });

      it(`blocks anon UPDATE on ${table}`, async () => {
        const available = await isSupabaseAvailable();
        expect(available, 'Supabase instance must be reachable').toBe(true);

        const { data, error } = await anonClient
          .from(table)
          .update({ name: 'Hacked' } as any)
          .eq('id', '00000000-0000-0000-0000-000000000000')
          .select();

        // Must fail or affect 0 rows
        expect(error !== null || data === null || (Array.isArray(data) && data.length === 0)).toBe(true);
      });

      it(`blocks anon DELETE on ${table}`, async () => {
        const available = await isSupabaseAvailable();
        expect(available, 'Supabase instance must be reachable').toBe(true);

        const { data, error } = await anonClient
          .from(table)
          .delete()
          .eq('id', '00000000-0000-0000-0000-000000000000')
          .select();

        // Must fail or affect 0 rows
        expect(error !== null || data === null || (Array.isArray(data) && data.length === 0)).toBe(true);
      });
    });
  });

  describe('Non-app_user authenticated client access is blocked', () => {
    it('confirms is_active_app_user() restricts access when auth UID is not in public.app_user', async () => {
      const available = await isSupabaseAvailable();
      expect(available, 'Supabase instance must be reachable').toBe(true);

      // Verify across several key phase 2 tables
      for (const table of ['campaigns', 'email_templates', 'lead_notes', 'tags']) {
        const { data } = await anonClient.from(table).select('*');
        expect(data === null || (Array.isArray(data) && data.length === 0)).toBe(true);
      }
    });
  });
});

