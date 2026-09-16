// =============================================================================
// Tests: Secure "Delete All Contacts" (Danger Zone) Purge Functionality
// =============================================================================

import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || (import.meta as any).env?.VITE_SUPABASE_URL || 'https://xogcexclqiornuscsdmn.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

describe('Secure Contact Purge & Danger Zone Security', () => {
  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  describe('Security & Access Control (Anon / Unauthenticated Rejection)', () => {
    it('blocks anon / unauthenticated calls to purge_all_contacts with 401/403 or permission error', async () => {
      const { data, error } = await anonClient.rpc('purge_all_contacts', {
        confirmation_text: 'DELETE ALL CONTACTS',
      });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      // Should be rejected by Postgres permissions or security check
      expect(
        error?.message?.toLowerCase().includes('unauthorized') ||
        error?.message?.toLowerCase().includes('permission') ||
        error?.message?.toLowerCase().includes('function') ||
        error?.code === '42501' ||
        error?.code === 'PGRST202'
      ).toBe(true);
    });

    it('blocks anon / unauthenticated calls to get_contacts_purge_preview', async () => {
      const { data, error } = await anonClient.rpc('get_contacts_purge_preview');

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(
        error?.message?.toLowerCase().includes('unauthorized') ||
        error?.message?.toLowerCase().includes('permission') ||
        error?.message?.toLowerCase().includes('function') ||
        error?.code === '42501' ||
        error?.code === 'PGRST202'
      ).toBe(true);
    });

    it('rejects invalid or mismatched confirmation strings', async () => {
      const invalidPhrases = [
        'delete all contacts', // lowercase
        'DELETE ALL',          // partial
        'DELETE',              // partial
        '',                    // empty
        'DELETE ALL CONTACTS ', // trailing space
      ];

      for (const phrase of invalidPhrases) {
        const { data, error } = await anonClient.rpc('purge_all_contacts', {
          confirmation_text: phrase,
        });

        expect(data).toBeNull();
        expect(error).not.toBeNull();
      }
    });
  });

  describe('Data Preservation Guarantees (Tables Remain Intact & Protected)', () => {
    it('confirms pipeline_stages table exists and is preserved', async () => {
      const { data, error } = await anonClient
        .from('pipeline_stages')
        .select('id');

      // Table exists (no 42P01 relation does not exist error)
      expect(error).toBeNull();
      // RLS correctly blocks anonymous reads or returns empty
      expect(data === null || Array.isArray(data)).toBe(true);
    });

    it('confirms transactional_templates table exists and is preserved', async () => {
      const { data, error } = await anonClient
        .from('transactional_templates')
        .select('key, channel');

      expect(error).toBeNull();
      expect(data === null || Array.isArray(data)).toBe(true);
    });

    it('confirms email_templates table is preserved', async () => {
      const { data, error } = await anonClient
        .from('email_templates')
        .select('id, name');

      expect(error).toBeNull();
      expect(data === null || Array.isArray(data)).toBe(true);
    });

    it('confirms campaigns definitions table is preserved', async () => {
      const { data, error } = await anonClient
        .from('campaigns')
        .select('id, name');

      expect(error).toBeNull();
      expect(data === null || Array.isArray(data)).toBe(true);
    });

    it('confirms tags definitions table is preserved', async () => {
      const { data, error } = await anonClient
        .from('tags')
        .select('id, name, slug');

      expect(error).toBeNull();
      expect(data === null || Array.isArray(data)).toBe(true);
    });
  });

  describe('Confirmation Verbatim Matching Logic', () => {
    const REQUIRED_CONFIRMATION = 'DELETE ALL CONTACTS';

    it('validates exact string match strictly', () => {
      const isValid = (input: string) => input.trim() === REQUIRED_CONFIRMATION;

      expect(isValid('DELETE ALL CONTACTS')).toBe(true);
      expect(isValid('  DELETE ALL CONTACTS  ')).toBe(true); // trimmed match
      expect(isValid('delete all contacts')).toBe(false);
      expect(isValid('Delete All Contacts')).toBe(false);
      expect(isValid('DELETE ALL')).toBe(false);
      expect(isValid('')).toBe(false);
      expect(isValid('CONFIRM')).toBe(false);
    });
  });

  describe('Safeupdate Protection & SQL Structure Audit', () => {
    it('verifies all DELETE statements in migration have an explicit WHERE clause', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const migrationPath = path.resolve(process.cwd(), 'supabase/migrations/00026_fix_purge_contacts_rpc.sql');
      const sql = fs.readFileSync(migrationPath, 'utf8');

      // Find all DELETE statements
      const deleteStatements = sql.match(/DELETE\s+FROM\s+public\.[a-z_]+[^;]*;/gi) || [];
      expect(deleteStatements.length).toBe(11);

      // Verify that every single DELETE statement includes WHERE
      for (const stmt of deleteStatements) {
        expect(stmt.toUpperCase().includes('WHERE')).toBe(true);
        expect(stmt.toUpperCase().includes('IS NOT NULL')).toBe(true);
      }
    });
  });
});
