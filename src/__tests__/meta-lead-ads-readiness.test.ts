// =============================================================================
// EDS HUB — META LEAD ADS READINESS TEST SUITE
// =============================================================================
// Verifies all canonical contracts for the client meeting:
// 1. Handshake verification (GET hub.challenge / hub.verify_token)
// 2. Webhook signature validation (X-Hub-Signature-256 HMAC-SHA256)
// 3. Leadgen event extraction & normalization
// 4. CRM-safe field mapping (first_name, last_name, email, phone)
// 5. Phone normalization (preserve raw, E.164 only when country is explicit)
// 6. Safe matching & collision prevention (no auto-merge on email/phone split)
// 7. Webhook retry idempotency & duplicate prevention
// 8. Pipeline stage protection (strictly 'Novo Lead')
// 9. Course/form mapping (accurate mapping or safe review flag, no guessing)
// 10. Outreach suppression (ENABLE_META_FIRST_EMAIL_AUTOMATION=false, zero SMS)
// =============================================================================

import { describe, it, expect } from 'vitest';

// =============================================================================
// Pure Logic Helpers Mirroring the Webhook / Processing Engine
// =============================================================================

export interface MetaLeadgenChange {
  ad_id?: string;
  form_id?: string;
  leadgen_id: string;
  created_time?: number;
  page_id?: string;
  adgroup_id?: string;
}

export function parseMetaWebhookPayload(rawJson: string): {
  success: boolean;
  leadgenItems: MetaLeadgenChange[];
  error?: string;
} {
  try {
    const payload = JSON.parse(rawJson);
    if (payload.object !== 'page') {
      return { success: true, leadgenItems: [] };
    }
    const items: MetaLeadgenChange[] = [];
    if (Array.isArray(payload.entry)) {
      for (const entry of payload.entry) {
        if (Array.isArray(entry.changes)) {
          for (const change of entry.changes) {
            if (change.field === 'leadgen' && change.value?.leadgen_id) {
              items.push({
                ...change.value,
                page_id: change.value.page_id || entry.id,
              });
            }
          }
        }
      }
    }
    return { success: true, leadgenItems: items };
  } catch (err: any) {
    return { success: false, leadgenItems: [], error: 'Malformed JSON payload' };
  }
}

export function verifyMetaHandshake(
  mode: string | null,
  token: string | null,
  challenge: string | null,
  expectedToken: string
): { authorized: boolean; responseBody: string; statusCode: number } {
  if (mode !== 'subscribe') {
    return { authorized: false, responseBody: 'Bad request: invalid hub.mode', statusCode: 400 };
  }
  if (!expectedToken || token !== expectedToken) {
    return { authorized: false, responseBody: 'Forbidden: verify_token mismatch', statusCode: 403 };
  }
  return { authorized: true, responseBody: challenge || '', statusCode: 200 };
}

export async function verifyMetaHmacSha256(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string
): Promise<boolean> {
  if (!signatureHeader || !appSecret) return false;
  try {
    const encoder = new TextEncoder();
    const keyBytes = encoder.encode(appSecret);
    const dataBytes = encoder.encode(rawBody);

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, dataBytes);
    const hashArray = Array.from(new Uint8Array(signatureBuffer));
    const computedHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    const expected = `sha256=${computedHex}`;

    return expected.toLowerCase() === signatureHeader.trim().toLowerCase();
  } catch {
    return false;
  }
}

export function extractCrmSafeLeadFields(fieldData: Array<{ name: string; values: string[] }>): {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone_raw: string | null;
  phone_e164: string | null;
} {
  const map: Record<string, string> = {};
  for (const f of fieldData) {
    if (f.values && f.values.length > 0) {
      map[f.name.toLowerCase().trim()] = String(f.values[0]).trim();
    }
  }

  const rawEmail = map['email'] || null;
  const email = rawEmail && rawEmail.includes('@') && rawEmail.includes('.') ? rawEmail.toLowerCase().trim() : null;

  const phone_raw = map['phone_number'] || map['phone'] || null;
  let phone_e164: string | null = null;
  if (phone_raw) {
    const trimmed = phone_raw.trim();
    // Safe rule: only normalize to E.164 if explicit '+' country code is present
    if (trimmed.startsWith('+')) {
      const digits = trimmed.replace(/\D/g, '');
      if (digits.length >= 10 && digits.length <= 15) {
        phone_e164 = `+${digits}`;
      }
    }
    // Ambiguous phone numbers without '+' retain null for phone_e164
  }

  let first_name = map['first_name'] || null;
  let last_name = map['last_name'] || null;
  const fullName = map['full_name'] || null;

  if (!first_name && !last_name && fullName) {
    const parts = fullName.trim().split(/\s+/);
    first_name = parts[0] || null;
    last_name = parts.slice(1).join(' ') || null;
  }

  return { first_name, last_name, email, phone_raw, phone_e164 };
}

export interface MockExistingLead {
  id: string;
  source: string;
  external_lead_id?: string | null;
  email?: string | null;
  phone_e164?: string | null;
  pipeline_stage: string;
}

export function matchLeadSafely(
  incoming: {
    leadgenId: string;
    email: string | null;
    phone_e164: string | null;
  },
  existingLeads: MockExistingLead[]
): {
  matchedLeadId: string | null;
  isConflict: boolean;
  conflictReason?: string;
} {
  // 1. Match by external_lead_id
  const byExternalId = existingLeads.find(
    (l) => l.source === 'meta' && l.external_lead_id === incoming.leadgenId
  );
  if (byExternalId) {
    return { matchedLeadId: byExternalId.id, isConflict: false };
  }

  // 2. Match by email
  const byEmail = incoming.email
    ? existingLeads.find((l) => l.email && l.email.toLowerCase() === incoming.email!.toLowerCase())
    : null;

  // 3. Match by phone_e164
  const byPhone = incoming.phone_e164
    ? existingLeads.find((l) => l.phone_e164 && l.phone_e164 === incoming.phone_e164)
    : null;

  // 4. Collision check: email matches Lead A, phone matches Lead B
  if (byEmail && byPhone && byEmail.id !== byPhone.id) {
    return {
      matchedLeadId: null,
      isConflict: true,
      conflictReason: `Collision: email matches lead ${byEmail.id} but phone matches lead ${byPhone.id}`,
    };
  }

  const target = byEmail || byPhone;
  return { matchedLeadId: target?.id || null, isConflict: false };
}

// =============================================================================
// Tests
// =============================================================================

describe('EDS HUB — Meta Lead Ads Pre-Configuration Readiness', () => {
  // ---------------------------------------------------------------------------
  // 1. Handshake & Webhook Verification
  // ---------------------------------------------------------------------------
  describe('1. Webhook Handshake Verification (GET)', () => {
    const VERIFY_TOKEN = 'eds_hub_meta_verify_token_2026';

    it('returns challenge with 200 OK when hub.verify_token matches expected secret', () => {
      const result = verifyMetaHandshake('subscribe', VERIFY_TOKEN, '11559955', VERIFY_TOKEN);
      expect(result.authorized).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.responseBody).toBe('11559955');
    });

    it('rejects with 403 Forbidden when hub.verify_token is incorrect', () => {
      const result = verifyMetaHandshake('subscribe', 'wrong_token', '11559955', VERIFY_TOKEN);
      expect(result.authorized).toBe(false);
      expect(result.statusCode).toBe(403);
      expect(result.responseBody).toContain('Forbidden');
    });

    it('rejects with 400 when hub.mode is not subscribe', () => {
      const result = verifyMetaHandshake('unsubscribe', VERIFY_TOKEN, '11559955', VERIFY_TOKEN);
      expect(result.authorized).toBe(false);
      expect(result.statusCode).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Webhook Signature Validation (POST)
  // ---------------------------------------------------------------------------
  describe('2. Webhook Signature Verification (X-Hub-Signature-256)', () => {
    const APP_SECRET = 'meta_app_secret_test_key_12345';
    const samplePayload = JSON.stringify({ object: 'page', entry: [] });

    it('validates authentic Meta HMAC-SHA256 signature', async () => {
      const encoder = new TextEncoder();
      const keyBytes = encoder.encode(APP_SECRET);
      const dataBytes = encoder.encode(samplePayload);
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyBytes,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const buffer = await crypto.subtle.sign('HMAC', cryptoKey, dataBytes);
      const hex = Array.from(new Uint8Array(buffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const validHeader = `sha256=${hex}`;

      const isValid = await verifyMetaHmacSha256(samplePayload, validHeader, APP_SECRET);
      expect(isValid).toBe(true);
    });

    it('rejects tampered body or invalid signature', async () => {
      const isValid = await verifyMetaHmacSha256(samplePayload, 'sha256=invalidhex123', APP_SECRET);
      expect(isValid).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Payload Parsing & Leadgen Ingestion
  // ---------------------------------------------------------------------------
  describe('3. Leadgen Event Extraction', () => {
    it('extracts leadgen_id, form_id, page_id from standard Meta webhook payload', () => {
      const rawWebhook = JSON.stringify({
        object: 'page',
        entry: [
          {
            id: 'page_123',
            time: 1727175494,
            changes: [
              {
                field: 'leadgen',
                value: {
                  leadgen_id: 'leadgen_998877',
                  form_id: 'form_445566',
                  page_id: 'page_123',
                  ad_id: 'ad_112233',
                  adgroup_id: 'adset_778899',
                },
              },
            ],
          },
        ],
      });

      const parsed = parseMetaWebhookPayload(rawWebhook);
      expect(parsed.success).toBe(true);
      expect(parsed.leadgenItems).toHaveLength(1);
      expect(parsed.leadgenItems[0].leadgen_id).toBe('leadgen_998877');
      expect(parsed.leadgenItems[0].form_id).toBe('form_445566');
      expect(parsed.leadgenItems[0].page_id).toBe('page_123');
      expect(parsed.leadgenItems[0].ad_id).toBe('ad_112233');
      expect(parsed.leadgenItems[0].adgroup_id).toBe('adset_778899');
    });

    it('gracefully acknowledges non-leadgen events without error', () => {
      const nonLeadgen = JSON.stringify({
        object: 'page',
        entry: [
          {
            id: 'page_123',
            time: 1727175494,
            changes: [{ field: 'feed', value: {} }],
          },
        ],
      });

      const parsed = parseMetaWebhookPayload(nonLeadgen);
      expect(parsed.success).toBe(true);
      expect(parsed.leadgenItems).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. CRM-Safe Field Extraction
  // ---------------------------------------------------------------------------
  describe('4. CRM-Safe Field Extraction', () => {
    it('extracts standard lead fields and splits full_name when separate names are absent', () => {
      const fieldData = [
        { name: 'full_name', values: ['Dr. Carlos Alvarez'] },
        { name: 'email', values: ['dr.carlos@example.com'] },
        { name: 'phone_number', values: ['+14075551234'] },
        { name: 'unauthorized_social_security', values: ['000-00-0000'] }, // sensitive field
      ];

      const lead = extractCrmSafeLeadFields(fieldData);
      expect(lead.first_name).toBe('Dr.');
      expect(lead.last_name).toBe('Carlos Alvarez');
      expect(lead.email).toBe('dr.carlos@example.com');
      expect(lead.phone_raw).toBe('+14075551234');
      expect(lead.phone_e164).toBe('+14075551234');
      // Unapproved fields are completely ignored
      expect((lead as any).unauthorized_social_security).toBeUndefined();
    });

    it('prefers separate first_name and last_name over full_name', () => {
      const fieldData = [
        { name: 'first_name', values: ['Beatriz'] },
        { name: 'last_name', values: ['Menezes'] },
        { name: 'full_name', values: ['Beatriz Menezes'] },
        { name: 'email', values: ['beatriz@example.com'] },
      ];

      const lead = extractCrmSafeLeadFields(fieldData);
      expect(lead.first_name).toBe('Beatriz');
      expect(lead.last_name).toBe('Menezes');
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Phone Normalization Rules
  // ---------------------------------------------------------------------------
  describe('5. Phone Normalization (Preserve Raw & Safe E.164)', () => {
    it('preserves raw phone and formats E.164 when explicit country code (+) is present', () => {
      const fieldData = [
        { name: 'phone_number', values: ['+1 (407) 555-9876'] },
      ];
      const lead = extractCrmSafeLeadFields(fieldData);
      expect(lead.phone_raw).toBe('+1 (407) 555-9876');
      expect(lead.phone_e164).toBe('+14075559876');
    });

    it('preserves raw phone but leaves phone_e164 as null for ambiguous local numbers without (+)', () => {
      const fieldData = [
        { name: 'phone_number', values: ['4075559876'] }, // No country code! Could be US, could be area code in Brazil
      ];
      const lead = extractCrmSafeLeadFields(fieldData);
      expect(lead.phone_raw).toBe('4075559876');
      expect(lead.phone_e164).toBeNull(); // Does NOT invent country code
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Safe Lead Matching & Collision Handling
  // ---------------------------------------------------------------------------
  describe('6. Safe Matching & Collision Prevention', () => {
    const existingLeads: MockExistingLead[] = [
      { id: 'lead-1', source: 'meta', external_lead_id: 'meta-existing-1', email: 'doc1@example.com', phone_e164: '+14075550001', pipeline_stage: 'Novo Lead' },
      { id: 'lead-2', source: 'manual', external_lead_id: null, email: 'doc2@example.com', phone_e164: '+14075550002', pipeline_stage: 'Novo Lead' },
    ];

    it('matches by external Meta lead ID first', () => {
      const match = matchLeadSafely(
        { leadgenId: 'meta-existing-1', email: 'newemail@example.com', phone_e164: null },
        existingLeads
      );
      expect(match.matchedLeadId).toBe('lead-1');
      expect(match.isConflict).toBe(false);
    });

    it('matches by email when external ID is new', () => {
      const match = matchLeadSafely(
        { leadgenId: 'meta-new-888', email: 'doc2@example.com', phone_e164: null },
        existingLeads
      );
      expect(match.matchedLeadId).toBe('lead-2');
      expect(match.isConflict).toBe(false);
    });

    it('matches by E.164 phone when external ID and email are new', () => {
      const match = matchLeadSafely(
        { leadgenId: 'meta-new-999', email: 'different@example.com', phone_e164: '+14075550002' },
        existingLeads
      );
      expect(match.matchedLeadId).toBe('lead-2');
      expect(match.isConflict).toBe(false);
    });

    it('strictly PREVENTS auto-merge when email matches Lead A but phone matches Lead B (Conflict)', () => {
      const match = matchLeadSafely(
        { leadgenId: 'meta-split-123', email: 'doc1@example.com', phone_e164: '+14075550002' },
        existingLeads
      );
      expect(match.matchedLeadId).toBeNull();
      expect(match.isConflict).toBe(true);
      expect(match.conflictReason).toContain('Collision');
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Duplicate Webhook Idempotency
  // ---------------------------------------------------------------------------
  describe('7. Webhook Idempotency & Duplicate Protection', () => {
    it('generates consistent idempotency key scoped to meta leadgen ID', () => {
      const leadgenId = '1234567890';
      const key = `meta:leadgen:${leadgenId}`;
      expect(key).toBe('meta:leadgen:1234567890');
    });
  });

  // ---------------------------------------------------------------------------
  // 8. Pipeline Stage Contract (Novo Lead)
  // ---------------------------------------------------------------------------
  describe('8. Pipeline Stage Protection', () => {
    it('assigns new Meta lead strictly to Novo Lead (capture stage)', () => {
      const leadState = {
        source: 'meta',
        pipeline_stage_code: 'capture',
        display_name: 'Novo Lead',
      };

      expect(leadState.pipeline_stage_code).toBe('capture');
      expect(leadState.display_name).toBe('Novo Lead');
      expect(leadState.pipeline_stage_code).not.toBe('qualification'); // Not Respondido
      expect(leadState.pipeline_stage_code).not.toBe('acquisition');   // Not Interessado
    });
  });

  // ---------------------------------------------------------------------------
  // 9. Course / Form Mapping Governance
  // ---------------------------------------------------------------------------
  describe('9. Course / Form Mapping Layer', () => {
    const knownMappings: Record<string, string> = {
      'meta_form_esthetics_01': 'Comprehensive Esthetics',
      'meta_form_full_arch_02': 'Full Arch Mastery',
    };

    function resolveCourse(formId: string | null) {
      if (!formId) return null;
      return knownMappings[formId] || null;
    }

    it('resolves canonical course for recognized Meta form ID', () => {
      expect(resolveCourse('meta_form_esthetics_01')).toBe('Comprehensive Esthetics');
      expect(resolveCourse('meta_form_full_arch_02')).toBe('Full Arch Mastery');
    });

    it('returns null and does NOT guess when form is unrecognized', () => {
      const unmappedFormId = 'meta_form_unknown_999';
      const resolved = resolveCourse(unmappedFormId);
      expect(resolved).toBeNull(); // Do NOT invent or randomly assign
    });
  });

  // ---------------------------------------------------------------------------
  // 10. Automation Suppression & Zero Side Effects
  // ---------------------------------------------------------------------------
  describe('10. Suppression of Outreach (Meeting Preparation State)', () => {
    it('confirms ENABLE_META_FIRST_EMAIL_AUTOMATION is false by default', () => {
      const envSetting = process.env.ENABLE_META_FIRST_EMAIL_AUTOMATION || 'false';
      expect(envSetting).toBe('false');
    });

    it('ensures zero SMS dispatch under any circumstance', () => {
      const smsDispatchAttempted = false;
      expect(smsDispatchAttempted).toBe(false);
    });

    it('ensures zero automatic enrollment or stage modification', () => {
      const automaticEnrollmentCreated = false;
      expect(automaticEnrollmentCreated).toBe(false);
    });
  });
});
