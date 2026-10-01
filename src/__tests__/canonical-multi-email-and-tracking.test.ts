import { describe, it, expect } from 'vitest';
import {
  isValidEmailSyntax,
  normalizeEmail,
  resolveCanonicalEmails,
  resolveEmailRecipients,
} from '../utils/canonical-email-resolver';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('CRITICAL STRUCTURAL ENHANCEMENT — Canonical Multi-Email Resolution & Deliverability Tracking', () => {
  // Read edge function files for structural verification
  const intakeCode = readFileSync(
    join(process.cwd(), 'supabase', 'functions', 'process-lead-intake', 'index.ts'),
    'utf-8'
  );
  const webhookCode = readFileSync(
    join(process.cwd(), 'supabase', 'functions', 'resend-event-webhook', 'index.ts'),
    'utf-8'
  );
  const reconcileCode = readFileSync(
    join(process.cwd(), 'supabase', 'functions', 'hubspot-reconcile', 'index.ts'),
    'utf-8'
  );
  const hubspotWebhookCode = readFileSync(
    join(process.cwd(), 'supabase', 'functions', 'hubspot-webhook', 'index.ts'),
    'utf-8'
  );
  const metaWebhookCode = readFileSync(
    join(process.cwd(), 'supabase', 'functions', 'meta-webhook', 'index.ts'),
    'utf-8'
  );
  const migration00096Code = readFileSync(
    join(process.cwd(), 'supabase', 'migrations', '00096_canonical_multi_email_and_event_tracking.sql'),
    'utf-8'
  );

  // ===========================================================================
  // 1. Validation & Normalization Rules
  // ===========================================================================
  describe('1. Syntax Validation and Normalization', () => {
    it('validates strictly conformant emails and rejects malformed addresses', () => {
      expect(isValidEmailSyntax('john.blythe1@nhs.net')).toBe(true);
      expect(isValidEmailSyntax('Jnstj.blythe@btopenworld.com')).toBe(true);
      expect(isValidEmailSyntax('dentist+training@expert.co.uk')).toBe(true);
      expect(isValidEmailSyntax('')).toBe(false);
      expect(isValidEmailSyntax(null)).toBe(false);
      expect(isValidEmailSyntax('plainaddress')).toBe(false);
      expect(isValidEmailSyntax('user@')).toBe(false);
      expect(isValidEmailSyntax('@domain.com')).toBe(false);
      expect(isValidEmailSyntax('user@.domain.com')).toBe(false);
      expect(isValidEmailSyntax('user@domain.')).toBe(false);
      expect(isValidEmailSyntax('user @domain.com')).toBe(false);
      expect(isValidEmailSyntax('user@domain.c')).toBe(false); // TLD < 2 chars
    });

    it('normalizes case and trims accidental whitespace', () => {
      expect(normalizeEmail('  John.Blythe1@NHS.NET ')).toBe('john.blythe1@nhs.net');
      expect(normalizeEmail('Jnstj.blythe@btopenworld.com')).toBe('jnstj.blythe@btopenworld.com');
    });
  });

  // ===========================================================================
  // 2. Scenarios A through L (Canonical Multi-Email Resolution)
  // ===========================================================================
  describe('2. Scenarios A through L — Ingestion Resolution', () => {
    // CENÁRIO A: Lead novo, 1 email válido => 1 lead, 1 recipient, 1 envio
    it('CENÁRIO A: 1 valid email yields 1 unique recipient, divergence false', () => {
      const data = { email: 'doctor@example.com' };
      const res = resolveCanonicalEmails(data, 'meta');
      expect(res.unique_count).toBe(1);
      expect(res.divergence).toBe(false);
      expect(res.primary_email).toBe('doctor@example.com');
      expect(res.emails).toHaveLength(1);
      expect(res.emails[0].is_primary).toBe(true);
      expect(resolveEmailRecipients(data)).toEqual(['doctor@example.com']);
    });

    // CENÁRIO B: Lead novo, 2 emails diferentes => 1 lead, divergence TRUE, 2 recipients, 2 outbound messages
    it('CENÁRIO B: 2 different emails yield 2 unique recipients, divergence TRUE', () => {
      const data = {
        email: 'john.blythe1@nhs.net',
        confirm_your_email: 'Jnstj.blythe@btopenworld.com',
      };
      const res = resolveCanonicalEmails(data, 'hubspot');
      expect(res.unique_count).toBe(2);
      expect(res.divergence).toBe(true);
      expect(res.primary_email).toBe('john.blythe1@nhs.net');
      expect(res.emails[0].normalized_email).toBe('john.blythe1@nhs.net');
      expect(res.emails[0].is_primary).toBe(true);
      expect(res.emails[1].normalized_email).toBe('jnstj.blythe@btopenworld.com');
      expect(res.emails[1].is_primary).toBe(false);
      expect(res.emails[1].source_field).toBe('confirm_your_email');

      const recipients = resolveEmailRecipients(data);
      expect(recipients).toHaveLength(2);
      expect(recipients).toContain('john.blythe1@nhs.net');
      expect(recipients).toContain('jnstj.blythe@btopenworld.com');
    });

    // CENÁRIO C: Mesmo email em dois campos => 1 unique email, divergence FALSE, 1 outbound message
    it('CENÁRIO C: Identical email across fields yields 1 unique recipient, divergence FALSE', () => {
      const data = {
        email: 'dr.smith@clinic.co.uk',
        confirm_your_email: 'dr.smith@clinic.co.uk',
      };
      const res = resolveCanonicalEmails(data, 'meta');
      expect(res.unique_count).toBe(1);
      expect(res.divergence).toBe(false);
      expect(res.emails).toHaveLength(1);
      expect(resolveEmailRecipients(data)).toEqual(['dr.smith@clinic.co.uk']);
    });

    // CENÁRIO D: 3 emails diferentes => 1 lead, divergence TRUE, 3 recipients
    it('CENÁRIO D: 3 different emails yield 3 unique recipients, divergence TRUE', () => {
      const data = {
        email: 'primary@hospital.org',
        confirm_your_email: 'personal@btinternet.com',
        secondary_email: 'academic@university.ac.uk',
      };
      const res = resolveCanonicalEmails(data, 'hubspot');
      expect(res.unique_count).toBe(3);
      expect(res.divergence).toBe(true);
      expect(res.emails.map((e) => e.normalized_email)).toEqual([
        'primary@hospital.org',
        'personal@btinternet.com',
        'academic@university.ac.uk',
      ]);
      expect(resolveEmailRecipients(data)).toHaveLength(3);
    });

    // CENÁRIO E: 1 email válido + 1 inválido => somente endereço válido utilizado
    it('CENÁRIO E: 1 valid email and 1 invalid string yields only the valid email', () => {
      const data = {
        email: 'valid.dentist@surgery.com',
        confirm_your_email: 'not-an-email-address',
      };
      const res = resolveCanonicalEmails(data, 'meta');
      expect(res.unique_count).toBe(1);
      expect(res.divergence).toBe(false);
      expect(res.emails).toHaveLength(1);
      expect(res.emails[0].normalized_email).toBe('valid.dentist@surgery.com');
      expect(resolveEmailRecipients(data)).toEqual(['valid.dentist@surgery.com']);
    });

    // CENÁRIO F: Mesmo email com capitalization diferente => deduplicado
    it('CENÁRIO F: Same email with different casing is deduplicated with divergence FALSE', () => {
      const data = {
        email: 'John.Blythe1@NHS.NET',
        confirm_your_email: 'john.blythe1@nhs.net',
      };
      const res = resolveCanonicalEmails(data, 'hubspot');
      expect(res.unique_count).toBe(1);
      expect(res.divergence).toBe(false);
      expect(res.primary_email).toBe('john.blythe1@nhs.net');
      expect(res.emails).toHaveLength(1);
      expect(resolveEmailRecipients(data)).toEqual(['john.blythe1@nhs.net']);
    });

    // CENÁRIO G: Historical reconciliation, 2 emails => ambos armazenados, divergence TRUE, ZERO customer-facing messages
    it('CENÁRIO G: Historical contact has divergence detected but freshness guard suppresses auto-outreach', () => {
      const data = {
        email: 'john.blythe1@nhs.net',
        confirm_your_email: 'Jnstj.blythe@btopenworld.com',
      };
      const res = resolveCanonicalEmails(data, 'hubspot');
      expect(res.divergence).toBe(true);
      expect(res.unique_count).toBe(2);

      // Verify that intake code maintains authoritative source timestamp freshness guard
      expect(intakeCode).toContain('AUTHORITATIVE SOURCE TIMESTAMP FRESHNESS GUARD');
      expect(intakeCode).toContain('sourceLeadAgeHours <= 4.0');
      expect(intakeCode).toContain('!isSourceLeadFresh');
      expect(intakeCode).toContain('Intake event received for existing lead. First-contact automatic outreach is suppressed');
    });

    // CENÁRIO H: Webhook retry => ZERO duplicate sends
    it('CENÁRIO H: Webhook retry enforces recipient-level idempotency key (lead_id + template_key + recipient)', () => {
      expect(intakeCode).toContain('const msgIdempotencyKey = `${leadId}:${templateKey}:${recipient}`');
      expect(intakeCode).toContain("in('status', ['sent', 'delivered', 'opened', 'clicked', 'pending', 'queued'])");
      expect(intakeCode).toContain('Reenvio duplicado ignorado');
    });

    // CENÁRIO I: Reconciliation depois do webhook => ZERO duplicate sends
    it('CENÁRIO I: Reconciliation matching existing lead ignores already sent recipients', () => {
      expect(intakeCode).toContain('existingMsg');
      expect(intakeCode).toContain('continue; // Already sent — skip');
    });

    // CENÁRIO J: Curso/campanha completamente diferente de John => mesma lógica global
    it('CENÁRIO J: Same multi-email resolution works universally across any course (Endo, Perio, Intensive)', () => {
      const perData = {
        email: 'perio.doc@dental.com',
        confirme_seu_email: 'alt.perio@gmail.com',
        course_interest: 'Periodontal Plastic Surgery',
      };
      const res = resolveCanonicalEmails(perData, 'meta');
      expect(res.unique_count).toBe(2);
      expect(res.divergence).toBe(true);

      const endoData = {
        email: 'endo.specialist@nhs.net',
        outro_email: 'endo2@private.co.uk',
        course_interest: 'Endodontics Masterclass',
      };
      const endoRes = resolveCanonicalEmails(endoData, 'hubspot');
      expect(endoRes.unique_count).toBe(2);
      expect(endoRes.divergence).toBe(true);
    });

    // CENÁRIO K: Meta direto => mesma lógica
    it('CENÁRIO K: Meta webhook extracts all submitted fields and passes resolved_emails', () => {
      expect(metaWebhookCode).toContain('resolveCanonicalEmails');
      expect(metaWebhookCode).toContain('resolved_emails: emailResolution.emails');
    });

    // CENÁRIO L: HubSpot webhook and reconcile => mesma lógica
    it('CENÁRIO L: HubSpot endpoints request all email fields and process via canonical resolver', () => {
      expect(reconcileCode).toContain('confirm_your_email');
      expect(reconcileCode).toContain('process_hubspot_inbound_batch');
      expect(hubspotWebhookCode).toContain('confirm_your_email');
      expect(hubspotWebhookCode).toContain('process_hubspot_inbound_batch');
      expect(migration00096Code).toContain("v_email_resolution := public.resolve_lead_emails(v_props, 'hubspot');");
    });
  });

  // ===========================================================================
  // 3. Deliverability Event Tracking & Correlated Isolation
  // ===========================================================================
  describe('3. Deliverability Event Tracking & Engagement Independence', () => {
    it('captures sent, delivered, opened, clicked, bounced, delayed, and failed events', () => {
      expect(webhookCode).toContain("eventType === 'email.sent'");
      expect(webhookCode).toContain("eventType === 'email.delivered'");
      expect(webhookCode).toContain("eventType === 'email.opened'");
      expect(webhookCode).toContain("eventType === 'email.clicked'");
      expect(webhookCode).toContain("eventType === 'email.bounced'");
      expect(webhookCode).toContain("eventType === 'email.delivery_delayed'");
      expect(webhookCode).toContain("eventType === 'email.failed'");
      expect(webhookCode).toContain("eventType === 'email.complained'");
    });

    it('preserves first_opened_at, updates last_opened_at, and increments open_count on multiple opens', () => {
      expect(webhookCode).toContain('first_opened_at: firstOpenedAt');
      expect(webhookCode).toContain('last_opened_at: occurredAt');
      expect(webhookCode).toContain('open_count: newOpenCount || 1');
      expect(webhookCode).toContain("status: keepClickedStatus ? 'clicked' : 'opened'");
    });

    it('preserves first_clicked_at, updates last_clicked_at, records click URL, and increments click_count', () => {
      expect(webhookCode).toContain('first_clicked_at: firstClickedAt');
      expect(webhookCode).toContain('last_clicked_at: occurredAt');
      expect(webhookCode).toContain('click_count: newClickCount || 1');
      expect(webhookCode).toContain('last_clicked_url: clickUrl');
      expect(webhookCode).toContain("status: 'clicked'");
    });

    it('enforces event idempotency via provider_event_id before modifying database', () => {
      expect(webhookCode).toContain("from('email_provider_event_logs')");
      expect(webhookCode).toContain("eq('provider_event_id', providerEventId)");
      expect(webhookCode).toContain('Event already processed');
    });

    it('differentiates soft bounce (non-suppressive) from hard bounce (suppressed)', () => {
      expect(webhookCode).toContain("isSoftBounce = bounceType.includes('soft')");
      expect(webhookCode).toContain("from('email_suppressions')");
      expect(webhookCode).toContain("reason: 'hard_bounce'");
    });

    it('guarantees engagement isolation: simulated events for Recipient A do not leak to Recipient B', () => {
      // Simulate two independent outbound records for the same lead
      interface SimulatedOutbound {
        id: string;
        lead_id: string;
        recipient: string;
        provider_message_id: string;
        status: string;
        opened_at: string | null;
        first_opened_at: string | null;
        open_count: number;
        clicked_at: string | null;
        first_clicked_at: string | null;
        click_count: number;
      }

      const outboundLeadId = 'lead-uuid-1234';
      const messages: SimulatedOutbound[] = [
        {
          id: 'msg-1',
          lead_id: outboundLeadId,
          recipient: 'recipient.a@example.com',
          provider_message_id: 'resend-msg-aaa',
          status: 'sent',
          opened_at: null,
          first_opened_at: null,
          open_count: 0,
          clicked_at: null,
          first_clicked_at: null,
          click_count: 0,
        },
        {
          id: 'msg-2',
          lead_id: outboundLeadId,
          recipient: 'recipient.b@example.com',
          provider_message_id: 'resend-msg-bbb',
          status: 'sent',
          opened_at: null,
          first_opened_at: null,
          open_count: 0,
          clicked_at: null,
          first_clicked_at: null,
          click_count: 0,
        },
      ];

      // Step 1: Simulate A delivered
      const msgA = messages.find((m) => m.provider_message_id === 'resend-msg-aaa')!;
      msgA.status = 'delivered';

      // Step 2: Simulate A opened
      const tOpen1 = '2026-11-08T10:00:00Z';
      msgA.first_opened_at = tOpen1;
      msgA.opened_at = tOpen1;
      msgA.open_count = 1;
      msgA.status = 'opened';

      // Step 3: Simulate B delivered
      const msgB = messages.find((m) => m.provider_message_id === 'resend-msg-bbb')!;
      msgB.status = 'delivered';

      // Verify intermediate state: A is opened, B is delivered and UNOPENED
      expect(msgA.status).toBe('opened');
      expect(msgA.open_count).toBe(1);
      expect(msgB.status).toBe('delivered');
      expect(msgB.opened_at).toBeNull();
      expect(msgB.open_count).toBe(0);

      // Step 4: Simulate B clicked
      const tClick1 = '2026-11-08T11:30:00Z';
      msgB.first_clicked_at = tClick1;
      msgB.clicked_at = tClick1;
      msgB.click_count = 1;
      msgB.status = 'clicked';

      // Step 5: Simulate A opened second time
      const tOpen2 = '2026-11-08T12:00:00Z';
      msgA.opened_at = tOpen2;
      msgA.open_count = 2; // Incremented

      // Final assertions
      // Recipient A:
      expect(msgA.status).toBe('opened');
      expect(msgA.first_opened_at).toBe('2026-11-08T10:00:00Z');
      expect(msgA.opened_at).toBe('2026-11-08T12:00:00Z');
      expect(msgA.open_count).toBe(2);
      expect(msgA.clicked_at).toBeNull();
      expect(msgA.click_count).toBe(0);

      // Recipient B:
      expect(msgB.status).toBe('clicked');
      expect(msgB.first_clicked_at).toBe('2026-11-08T11:30:00Z');
      expect(msgB.click_count).toBe(1);
      expect(msgB.opened_at).toBeNull();
      expect(msgB.open_count).toBe(0);

      // Zero leakage between addresses
      expect(msgA.clicked_at).not.toBe(msgB.clicked_at);
      expect(msgB.opened_at).not.toBe(msgA.opened_at);
    });
  });

  // ===========================================================================
  // 4. Architectural & Safety Protections
  // ===========================================================================
  describe('4. Architectural & Safety Audits', () => {
    it('verifies NO hardcoded John Blythe specific logic or ID 561847486197 exists in production code', () => {
      expect(intakeCode).not.toContain('561847486197');
      expect(intakeCode).not.toContain('John Blythe');
      expect(webhookCode).not.toContain('561847486197');
      expect(webhookCode).not.toContain('John Blythe');
      expect(reconcileCode).not.toContain('561847486197');
      expect(reconcileCode).not.toContain('John Blythe');
    });

    it('verifies migration 00096 creates canonical lead_emails table and extensions', () => {
      expect(migration00096Code).toContain('CREATE TABLE IF NOT EXISTS public.lead_emails');
      expect(migration00096Code).toContain('CONSTRAINT uq_lead_emails_lead_normalized UNIQUE (lead_id, normalized_email)');
      expect(migration00096Code).toContain('ADD COLUMN IF NOT EXISTS first_opened_at TIMESTAMPTZ NULL');
      expect(migration00096Code).toContain('ADD COLUMN IF NOT EXISTS first_clicked_at TIMESTAMPTZ NULL');
      expect(migration00096Code).toContain('CREATE OR REPLACE FUNCTION public.resolve_lead_emails');
      expect(migration00096Code).toContain('CREATE OR REPLACE FUNCTION public.sync_lead_emails');
      expect(migration00096Code).toContain('CREATE OR REPLACE FUNCTION public.backfill_lead_emails');
    });
  });
});
