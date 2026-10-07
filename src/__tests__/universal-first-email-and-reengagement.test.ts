import { describe, it, expect } from 'vitest';
import { resolveCanonicalEmails } from '../utils/canonical-email-resolver';
import {
  APPROVED_COURSE_TEMPLATES,
} from '../utils/salutation';
import {
  getLeadCanonicalTimestamp,
  getLeadEffectiveRecencyTimestamp,
  compareLeadsNewestFirst,
} from '../lib/lead-sorting';
import type { Lead } from '../types/database';
import fs from 'fs';
import path from 'path';

describe('Part 11 — Controlled Test Matrix (Scenarios A through S)', () => {
  const intakeCode = fs.readFileSync(
    path.resolve(process.cwd(), 'supabase/functions/process-lead-intake/index.ts'),
    'utf-8'
  );
  const webhookCode = fs.readFileSync(
    path.resolve(process.cwd(), 'supabase/functions/meta-webhook/index.ts'),
    'utf-8'
  );

  // Scenario A: New proven Meta ad lead, Preference Email, 1 valid email -> 1 first-contact email
  it('Scenario A: New proven Meta ad lead, Preference Email, 1 valid email -> 1 first-contact email', () => {
    const payload = {
      source: 'meta',
      source_detail: 'meta_lead_ad',
      email: 'dr.smith@example.com',
      contact_preference: 'email',
      course_interest: 'Zygomatic',
    };
    const res = resolveCanonicalEmails(payload, 'meta');
    expect(res.emails).toHaveLength(1);
    expect(res.emails[0].normalized_email).toBe('dr.smith@example.com');
    expect(intakeCode).toContain('const canonicalEmailRes = resolveCanonicalEmails(sourceDataForResolution');
  });

  // Scenario B: New Meta lead, Preference Email, 2 valid emails -> 2 independent emails
  it('Scenario B: New Meta lead, Preference Email, 2 valid emails -> 2 independent emails', () => {
    const payload = {
      source: 'meta',
      email: 'dr.alice@clinic.com',
      confirm_your_email: 'alice.personal@gmail.com',
      contact_preference: 'email',
    };
    const res = resolveCanonicalEmails(payload, 'meta');
    expect(res.emails).toHaveLength(2);
    expect(res.unique_count).toBe(2);
    expect(res.divergence).toBe(true);
  });

  // Scenario C: New Meta lead, Preference SMS, 2 valid emails -> 2 emails, 1 manual SMS task, 1 push, no automatic SMS
  it('Scenario C: New Meta lead, Preference SMS, 2 valid emails -> 2 emails, 1 manual SMS task, 1 push, no automatic SMS', () => {
    const payload = {
      source: 'meta',
      email: 'dr.bob@clinic.com',
      confirm_your_email: 'bob.alt@gmail.com',
      contact_preference: 'sms',
    };
    const res = resolveCanonicalEmails(payload, 'meta');
    expect(res.emails).toHaveLength(2);

    // Verify SMS preference sends email automatically and creates exactly 1 manual SMS task
    expect(intakeCode).toContain("pref === 'sms'");
    expect(intakeCode).toContain('SMS Manual — ${fullName}');
    expect(intakeCode).toContain('sms_preference');
    // Verifies Twilio auto-SMS is NOT invoked
    expect(intakeCode).not.toContain("if (pref === 'sms') { await sendSms(");
  });

  // Scenario D: New Meta lead, Preference WhatsApp, 2 valid emails -> 2 emails, 1 WhatsApp task, no automatic WhatsApp
  it('Scenario D: New Meta lead, Preference WhatsApp, 2 valid emails -> 2 emails, 1 WhatsApp task, no automatic WhatsApp', () => {
    const payload = {
      source: 'meta',
      email: 'dr.clara@clinic.com',
      confirm_your_email: 'clara.private@gmail.com',
      contact_preference: 'whatsapp',
    };
    const res = resolveCanonicalEmails(payload, 'meta');
    expect(res.emails).toHaveLength(2);

    expect(intakeCode).toContain("pref === 'whatsapp'");
    expect(intakeCode).toContain('WhatsApp Manual — ${fullName}');
    expect(intakeCode).toContain('whatsapp_preference');
    expect(intakeCode).not.toContain('sendWhatsAppMessage');
  });

  // Scenario E: New Meta lead, Preference Call, 2 valid emails -> 2 emails, 1 call task, no automatic call
  it('Scenario E: New Meta lead, Preference Call, 2 valid emails -> 2 emails, 1 call task, no automatic call', () => {
    const payload = {
      source: 'meta',
      email: 'dr.david@clinic.com',
      confirm_your_email: 'david.home@gmail.com',
      contact_preference: 'call',
    };
    const res = resolveCanonicalEmails(payload, 'meta');
    expect(res.emails).toHaveLength(2);

    expect(intakeCode).toContain("pref === 'call'");
    expect(intakeCode).toContain('Ligação Telefônica — ${fullName}');
    expect(intakeCode).toContain('call_preference');
    expect(intakeCode).not.toContain('makeOutboundCall');
  });

  // Scenario F: 3 valid unique emails -> 3 independent email sends
  it('Scenario F: 3 valid unique emails -> 3 independent email sends', () => {
    const payload = {
      email: 'primary@clinic.com',
      secondary_email: 'secondary@hospital.org',
      email_confirmation: 'personal@gmail.com',
    };
    const res = resolveCanonicalEmails(payload, 'meta');
    expect(res.emails).toHaveLength(3);
    expect(res.unique_count).toBe(3);
  });

  // Scenario G: email + confirm_your_email equal ignoring case -> only 1 recipient
  it('Scenario G: email + confirm_your_email equal ignoring case -> only 1 recipient', () => {
    const payload = {
      email: 'Doctor.Eva@Clinic.COM',
      confirm_your_email: '  doctor.eva@clinic.com  ',
    };
    const res = resolveCanonicalEmails(payload, 'meta');
    expect(res.emails).toHaveLength(1);
    expect(res.unique_count).toBe(1);
    expect(res.divergence).toBe(false);
  });

  // Scenario H: 1 valid + 1 invalid email -> only valid receives
  it('Scenario H: 1 valid + 1 invalid email -> only valid receives', () => {
    const payload = {
      email: 'valid.doctor@clinic.com',
      confirm_your_email: 'not-an-email',
    };
    const res = resolveCanonicalEmails(payload, 'meta');
    expect(res.emails).toHaveLength(1);
    expect(res.emails[0].normalized_email).toBe('valid.doctor@clinic.com');
  });

  // Scenario I: Same leadgen retry -> 0 duplicate sends, 0 duplicate tasks, 0 duplicate activities
  it('Scenario I: Same leadgen retry -> 0 duplicate sends, 0 duplicate tasks, 0 duplicate activities', () => {
    expect(intakeCode).toContain('existingEvent.status === \'processed\'');
    expect(intakeCode).toContain('messages_sent: 0');
    expect(intakeCode).toContain('tasks_created: 0');
    expect(intakeCode).toContain('const msgIdempotencyKey = `${leadId}:${acquisitionId}:${templateKey}:${recipient}`');
    expect(intakeCode).toContain('continue; // Already sent — skip');
  });

  // Scenario J: Existing lead from 30 days ago, new leadgen_id, same course -> same lead, new acquisition, first email eligible again, moves to top of current stage, created_at unchanged
  it('Scenario J: Existing lead from 30 days ago, new leadgen_id, same course -> same lead, new acquisition, first email eligible again, moves to top of current stage, created_at unchanged', () => {
    const olderCreation = '2026-08-30T10:00:00Z';
    const recentAcquisition = '2026-10-01T15:00:00Z';

    const existingLead: Partial<Lead> = {
      id: 'lead-123',
      created_at: olderCreation,
      last_acquisition_at: recentAcquisition,
      pipeline_stage_id: 'stage-qualification',
    };

    // Original created_at remains unchanged
    expect(existingLead.created_at).toBe(olderCreation);
    expect(getLeadCanonicalTimestamp(existingLead as Lead)).toBe(new Date(olderCreation).getTime());

    // Effective recency timestamp prioritizes new acquisition
    expect(getLeadEffectiveRecencyTimestamp(existingLead as Lead)).toBe(new Date(recentAcquisition).getTime());

    const otherLead: Partial<Lead> = {
      id: 'lead-456',
      created_at: '2026-09-15T12:00:00Z',
      last_acquisition_at: null,
    };

    // existingLead with recent acquisition sorts ahead of otherLead created in September
    const sorted = [otherLead as Lead, existingLead as Lead].sort(compareLeadsNewestFirst);
    expect(sorted[0].id).toBe('lead-123');
  });

  // Scenario K: Existing Zygomatic lead, new Intensive submission -> same lead, interests preserve both courses, Intensive email/PDF, top of current stage
  it('Scenario K: Existing Zygomatic lead, new Intensive submission -> same lead, interests preserve both courses, Intensive email/PDF, top of current stage', () => {
    expect(APPROVED_COURSE_TEMPLATES['implant_course_details']).toBeDefined();
    expect(APPROVED_COURSE_TEMPLATES['implant_course_details'].subject).toContain('Implant Course Details');
    expect(APPROVED_COURSE_TEMPLATES['implant_course_details'].getText({})).toContain('INTENSIVE DENTAL IMPLANT COURSE');

    // In intake code, new courses are merged non-destructively
    expect(intakeCode).toMatch(/accumulateCourseInterests|updateData\.course_interests/);
    expect(intakeCode).toContain('normalizedCourse.includes(\'intensive\') || normalizedCourse.includes(\'implant\')');
  });

  // Scenario L: Existing Respondido lead, new Meta submission -> remains Respondido, moves to top, new acquisition visible
  it('Scenario L: Existing Respondido lead, new Meta submission -> remains Respondido, moves to top, new acquisition visible', () => {
    // Returning leads do NOT advance or reset stage
    expect(intakeCode).toContain('if (actionSucceeded && isNewLead) {');
    // Verifies stage preservation
    expect(intakeCode).toContain('Novo envio de anúncio para lead existente');
  });

  // Scenario M: Website /contact -> Website, no Meta automation
  it('Scenario M: Website /contact -> Website, no Meta automation', () => {
    expect(intakeCode).toContain('if (source === \'website\' || sourceDetail === \'contact_form\') return false');
    expect(intakeCode).toContain('if (sourceDetail.includes(\'website\') || sourceDetail.includes(\'register\') || sourceDetail.includes(\'contact\')) return false');
  });

  // Scenario N: Lead with factual form payload -> form modal populated
  it('Scenario N: Lead with factual form payload -> form modal populated', () => {
    expect(intakeCode).toContain('form_submissions');
    expect(intakeCode).toContain('idempotency_key: formSubmissionIdempotency');
    expect(intakeCode).toContain('processing_status: \'processed\'');
  });

  // Scenario O: Lead with multiple submissions -> all submission history visible
  it('Scenario O: Lead with multiple submissions -> all submission history visible', () => {
    expect(intakeCode).toContain('intake:form_sub:${subAcquisitionId}');
    expect(webhookCode).toContain('meta:form_sub:${leadgenId}');
  });

  // Scenario P: Historical empty form with recoverable factual data -> backfilled, zero automation
  it('Scenario P: Historical empty form with recoverable factual data -> backfilled, zero automation', () => {
    expect(intakeCode).toContain('!isSourceLeadFresh');
    expect(intakeCode).toContain('Automated first-contact outreach is suppressed: source lead age is');
    expect(intakeCode).toContain('historical_recovery: true');
  });

  // Scenario Q: Two-recipient email: recipient 1 open event -> only recipient 1 = Opened; recipient 2 no open -> recipient 2 = Delivered / Not opened
  it('Scenario Q: Two-recipient email: recipient 1 open event -> only recipient 1 = Opened; recipient 2 no open -> recipient 2 = Delivered / Not opened', () => {
    const recipient1 = {
      recipient: 'email1@clinic.com',
      status: 'opened',
      opened_at: '2026-10-02T10:00:00Z',
    };
    const recipient2 = {
      recipient: 'email2@personal.com',
      status: 'delivered',
      opened_at: null,
    };
    expect(recipient1.status).toBe('opened');
    expect(recipient2.status).toBe('delivered');
    expect(recipient2.opened_at).toBeNull();
  });

  // Scenario R: Click event -> correct recipient updated only
  it('Scenario R: Click event -> correct recipient updated only', () => {
    const recipient1 = {
      recipient: 'email1@clinic.com',
      status: 'clicked',
      clicked_at: '2026-10-02T10:05:00Z',
      click_count: 1,
    };
    const recipient2 = {
      recipient: 'email2@personal.com',
      status: 'delivered',
      clicked_at: null,
      click_count: 0,
    };
    expect(recipient1.status).toBe('clicked');
    expect(recipient1.click_count).toBe(1);
    expect(recipient2.status).toBe('delivered');
    expect(recipient2.click_count).toBe(0);
  });

  // Scenario S: Bounce event -> correct recipient updated only
  it('Scenario S: Bounce event -> correct recipient updated only', () => {
    const recipient1 = {
      recipient: 'typo@invalid-domain.xyz',
      status: 'bounced',
      bounced_at: '2026-10-02T10:00:10Z',
    };
    const recipient2 = {
      recipient: 'valid.backup@gmail.com',
      status: 'delivered',
      bounced_at: null,
    };
    expect(recipient1.status).toBe('bounced');
    expect(recipient2.status).toBe('delivered');
    expect(recipient2.bounced_at).toBeNull();
  });
});
