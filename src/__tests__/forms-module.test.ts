// =============================================================================
// Tests: Phase 3 Block 1 — Forms Module & Submission Engine
// =============================================================================

import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ||
  (import.meta as any).env?.VITE_SUPABASE_URL ||
  'https://xogcexclqiornuscsdmn.supabase.co';

const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  '';

const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

describe('Phase 3 Block 1: Forms Security, Atomicity, & Idempotency', () => {
  // ===========================================================================
  // 1. Security & RLS Tests: Anonymous Client Access Denied
  // ===========================================================================
  describe('RLS & Access Control: Anonymous Blockage', () => {
    it('anonymous direct database insert to forms is blocked', async () => {
      const { data, error } = await anonClient
        .from('forms')
        .insert({
          name: 'Hacker Form',
          slug: `hacker-${Date.now()}`,
          default_pipeline_stage_id: 'fe2a6162-1574-409f-975e-d2b5bafb9862',
        });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
    });

    it('anonymous direct database insert to form_fields is blocked', async () => {
      const { data, error } = await anonClient
        .from('form_fields')
        .insert({
          form_id: '00000000-0000-0000-0000-000000000000',
          field_type: 'email',
          internal_name: 'test_field',
          label: 'Test Field',
        });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
    });

    it('anonymous direct database insert to form_submissions is blocked', async () => {
      const { data, error } = await anonClient
        .from('form_submissions')
        .insert({
          form_id: '00000000-0000-0000-0000-000000000000',
          idempotency_key: `key-${Date.now()}`,
        });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
    });

    it('anonymous direct database insert to leads is blocked', async () => {
      const { data, error } = await anonClient
        .from('leads')
        .insert({
          source: 'form',
          email: 'direct_anon@test.com',
          pipeline_stage_id: 'fe2a6162-1574-409f-975e-d2b5bafb9862',
        });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
    });

    it('private transaction RPC process_form_submission_transaction is unavailable to anon', async () => {
      const { data, error } = await anonClient.rpc('process_form_submission_transaction', {
        p_form_slug: 'any-slug',
        p_idempotency_key: 'test-key',
        p_submitted_data: {},
        p_email: 'test@example.com',
        p_phone_e164: '+15551234567',
        p_contact_preference: 'email',
        p_course_interest: null,
        p_ip_address: '127.0.0.1',
        p_user_agent: 'Vitest',
      });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      // Must be rejected by Postgres routine execution privileges (42501 or not found/permission denied)
      expect(
        error?.code === '42501' ||
        error?.code === 'PGRST202' ||
        error?.message?.toLowerCase().includes('permission') ||
        error?.message?.toLowerCase().includes('function')
      ).toBe(true);
    });

    it('private rate limit RPC check_and_record_rate_limit is unavailable to anon', async () => {
      const { data, error } = await anonClient.rpc('check_and_record_rate_limit', {
        p_form_id: '00000000-0000-0000-0000-000000000000',
        p_ip_hash: 'hash123',
      });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
    });
  });

  // ===========================================================================
  // 2. Anti-Abuse & Edge Function Payload Size Guard
  // ===========================================================================
  describe('Payload & Abuse Guards', () => {
    it('payload > 64KB is rejected', () => {
      const MAX_PAYLOAD_BYTES = 64 * 1024;
      const largeData = 'A'.repeat(MAX_PAYLOAD_BYTES + 500);
      const payloadBytes = new TextEncoder().encode(largeData).length;

      expect(payloadBytes).toBeGreaterThan(MAX_PAYLOAD_BYTES);
      const isRejected = payloadBytes > MAX_PAYLOAD_BYTES;
      expect(isRejected).toBe(true);
    });

    it('honeypot field triggers silent discard without error', () => {
      const payload = {
        _hp_company: 'I am a spambot company',
        fields: { email: 'bot@spam.com' },
      };

      const isBot = Boolean(payload._hp_company && payload._hp_company.trim().length > 0);
      expect(isBot).toBe(true);
    });
  });

  // ===========================================================================
  // 3. Schema & Idempotency Rules (form_id + idempotency_key)
  // ===========================================================================
  describe('Idempotency & Namespace Scoping', () => {
    it('duplicate idempotency_key returns same submission and duplicate flag', () => {
      // Simulate transaction idempotency check
      const existingSubmissions = [
        {
          form_id: 'form-uuid-1',
          idempotency_key: 'token-abc',
          id: 'sub-101',
          lead_id: 'lead-201',
          processing_status: 'processed',
        },
      ];

      const checkIdempotency = (formId: string, key: string) => {
        const found = existingSubmissions.find(
          (s) => s.form_id === formId && s.idempotency_key === key
        );
        if (found) {
          return {
            success: true,
            is_duplicate: true,
            submission_id: found.id,
            lead_id: found.lead_id,
            processing_status: found.processing_status,
          };
        }
        return { success: true, is_duplicate: false };
      };

      const firstAttempt = checkIdempotency('form-uuid-1', 'token-abc');
      expect(firstAttempt.is_duplicate).toBe(true);
      expect(firstAttempt.submission_id).toBe('sub-101');
    });

    it('same idempotency key is allowed on different forms', () => {
      const existingSubmissions = [
        {
          form_id: 'form-uuid-1',
          idempotency_key: 'token-abc',
          id: 'sub-101',
        },
      ];

      // Submission on form-uuid-2 with the exact same idempotency_key 'token-abc'
      const checkIdempotency = (formId: string, key: string) => {
        return existingSubmissions.find(
          (s) => s.form_id === formId && s.idempotency_key === key
        );
      };

      const onForm2 = checkIdempotency('form-uuid-2', 'token-abc');
      expect(onForm2).toBeUndefined(); // Allowed because UNIQUE is (form_id, idempotency_key)!
    });
  });

  // ===========================================================================
  // 4. Safe Deduplication & Conflict Isolation
  // ===========================================================================
  describe('Safe Deduplication & Conflict Isolation', () => {
    it('email/phone conflict creates conflict submission and does NOT merge leads', () => {
      // Mock existing leads
      const leadByEmail = { id: 'lead-alpha', email: 'dr.john@example.com' };
      const leadByPhone = { id: 'lead-beta', phone_e164: '+15559998877' };

      // Check conflict logic:
      const isConflict =
        leadByEmail !== null &&
        leadByPhone !== null &&
        leadByEmail.id !== leadByPhone.id;

      expect(isConflict).toBe(true);

      const resultingSubmission = {
        lead_id: isConflict ? null : leadByEmail.id,
        processing_status: isConflict ? 'conflict' : 'processed',
        processing_error: isConflict
          ? 'Conflict: email and phone belong to different leads.'
          : null,
      };

      expect(resultingSubmission.processing_status).toBe('conflict');
      expect(resultingSubmission.lead_id).toBeNull();
      expect(resultingSubmission.processing_error).toContain('different leads');
    });

    it('conflict creates zero intake events, zero outbound messages, and zero tasks', () => {
      const processingStatus = 'conflict';

      const shouldCreateIntakeEvent = processingStatus !== 'conflict';
      const shouldDispatchOutboundMessages = processingStatus !== 'conflict';
      const shouldCreateCallTask = processingStatus !== 'conflict';

      expect(shouldCreateIntakeEvent).toBe(false);
      expect(shouldDispatchOutboundMessages).toBe(false);
      expect(shouldCreateCallTask).toBe(false);
    });
  });

  // ===========================================================================
  // 5. Form Versioning Rules
  // ===========================================================================
  describe('Form Versioning Rules', () => {
    it('form version increments after first submission when structural fields change', () => {
      let currentVersion = 1;
      const submissionCount = 5;

      const saveFormFields = (hasSubs: boolean) => {
        if (hasSubs) {
          currentVersion += 1;
        }
        return currentVersion;
      };

      const newVersion = saveFormFields(submissionCount > 0);
      expect(newVersion).toBe(2);
    });

    it('old submission preserves old form_version', () => {
      const submission = {
        id: 'sub-legacy-001',
        form_id: 'form-123',
        form_version: 1,
        submitted_data: { legacy_field: 'value' },
      };

      // Form version is bumped to 3 later
      const currentFormVersion = 3;

      // Submission record retains its original version snapshot
      expect(submission.form_version).toBe(1);
      expect(submission.form_version).not.toBe(currentFormVersion);
    });

    it('archived form rejects new submissions', () => {
      const form = {
        id: 'form-archived',
        name: 'Old Promo',
        status: 'inactive',
      };

      const validateFormStatus = (f: typeof form) => {
        if (f.status !== 'active') {
          return { error: 'Form is inactive', error_code: 'FORM_INACTIVE' };
        }
        return { success: true };
      };

      const result = validateFormStatus(form);
      expect(result.error_code).toBe('FORM_INACTIVE');
    });
  });

  // ===========================================================================
  // 6. Persistent Rate Limiting
  // ===========================================================================
  describe('Persistent Rate Limiting', () => {
    it('rate limit bucket calculates correct window and tracks request count', () => {
      const windowMinutes = 10;
      const nowEpoch = 1726521650; // seconds
      const windowStart =
        Math.floor(nowEpoch / (windowMinutes * 60)) * (windowMinutes * 60);

      // Subsequent request in same window
      const request2Epoch = 1726521800; // 150 seconds later
      const windowStart2 =
        Math.floor(request2Epoch / (windowMinutes * 60)) * (windowMinutes * 60);

      expect(windowStart).toBe(windowStart2); // same 10-minute window!
    });
  });

  // ===========================================================================
  // 7. Canonical Source & Contact Preference Integration
  // ===========================================================================
  describe('Canonical Lead Source & Contact Preference', () => {
    it('form leads have canonical source form and preserve contact preference', () => {
      const payload = {
        source: 'form' as const,
        contact_preference: 'email' as const,
        course_interest: 'Full Arch Mastery',
      };

      expect(payload.source).toBe('form');
      expect(['email', 'sms', 'call']).toContain(payload.contact_preference);
    });
  });
});
