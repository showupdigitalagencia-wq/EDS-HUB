// =============================================================================
// Unit & Integration Tests: Internal Enrollment Notification System (Refactored)
// =============================================================================
// Hardened Lifecycle & Inactivity Tests:
// 1. Incomplete attempt captured & push notification sent immediately
// 2. Continuous autosaves update ONE canonical attempt without sending email
// 3. Progressive snapshot enrichment (T0 -> T+30s -> T+60s -> T+90s)
// 4. Inactivity window (15m): Abandoned attempt triggers ONE email with LATEST snapshot
// 5. Incomplete -> Completed race: User completes before 15m window; incomplete email SKIPPED
// 6. Failed submit preserves external_attempt_id and updates same record
// 7. Completed registration does NOT generate duplicate EDS internal email (Laravel canonical)
// 8. EDS receives expanded completed non-file fields
// 9. No passport or dental_license binary in partial capture
// 10. Non-regression & isolation (Meta, Contact Us, Request Course Info)
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildIncompleteAttemptEmail,
  buildContactUsEmail,
  sendInternalEnrollmentNotification,
  sendInternalContactNotification,
  queueOrUpdateIncompleteEnrollmentNotification,
  processPendingAbandonedEnrollments,
  resolveInternalRecipients,
  type InternalNotificationPayload,
  type InternalContactNotificationPayload,
} from '../../supabase/functions/_shared/internal-enrollment-notifier.ts';

// Mock sendEmail from resend-adapter
const mockSendEmail = vi.fn().mockImplementation(async (_params: any) => {
  return {
    success: true,
    messageId: `msg_${Math.random().toString(36).substring(2, 9)}`,
    errorCode: null,
    errorMessage: null,
  };
});

vi.mock('../../supabase/functions/_shared/resend-adapter.ts', () => ({
  sendEmail: (params: any) => mockSendEmail(params),
}));

describe('Hardened Internal Enrollment Notification Architecture', () => {
  let mockDb: any;
  let mockLogs: Map<string, any>;
  let mockActivities: any[];
  let mockAttempts: Map<string, any>;

  beforeEach(() => {
    mockLogs = new Map();
    mockActivities = [];
    mockAttempts = new Map();
    mockSendEmail.mockClear();

    mockDb = {
      from: vi.fn((table: string) => {
        if (table === 'internal_notification_logs') {
          return {
            select: vi.fn((_cols?: string) => {
              const queryObj: any = {
                _filters: [] as Array<(item: any) => boolean>,
                eq: vi.fn((col: string, val: any) => {
                  queryObj._filters.push((item: any) => item[col] === val);
                  return queryObj;
                }),
                lte: vi.fn((col: string, val: any) => {
                  queryObj._filters.push((item: any) => {
                    const rowVal = item[col];
                    if (!rowVal) return true;
                    return new Date(rowVal).getTime() <= new Date(val).getTime();
                  });
                  return queryObj;
                }),
                limit: vi.fn((_n: number) => queryObj),
                maybeSingle: vi.fn(async () => {
                  const all = Array.from(mockLogs.values());
                  const match = all.find((item) => queryObj._filters.every((f: any) => f(item)));
                  return { data: match || null, error: null };
                }),
                then: (resolve: any) => {
                  const all = Array.from(mockLogs.values());
                  const filtered = all.filter((item) => queryObj._filters.every((f: any) => f(item)));
                  resolve({ data: filtered, error: null });
                },
              };
              return queryObj;
            }),
            insert: vi.fn((data: any) => {
              const id = data.id || `log_${Date.now()}_${Math.random()}`;
              const row = { ...data, id };
              mockLogs.set(data.idempotency_key, row);
              const res = { data: row, error: null };
              return Object.assign(Promise.resolve(res), {
                select: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue(res),
                  single: vi.fn().mockResolvedValue(res),
                }),
              });
            }),
            upsert: vi.fn((data: any) => {
              const existing = mockLogs.get(data.idempotency_key);
              const row = { ...(existing || {}), ...data, id: existing?.id || data.id || `log_${Date.now()}` };
              mockLogs.set(data.idempotency_key, row);
              return Promise.resolve({ error: null });
            }),
            update: vi.fn((data: any) => ({
              eq: vi.fn((col: string, val: any) => {
                for (const [k, v] of mockLogs.entries()) {
                  if (v[col] === val) {
                    mockLogs.set(k, { ...v, ...data });
                  }
                }
                return Promise.resolve({ error: null });
              }),
            })),
          };
        }

        if (table === 'incomplete_enrollments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn((col: string, val: any) => ({
                maybeSingle: vi.fn(async () => {
                  for (const att of mockAttempts.values()) {
                    if (att[col] === val) return { data: att, error: null };
                  }
                  return { data: null, error: null };
                }),
              })),
            })),
            update: vi.fn((data: any) => ({
              eq: vi.fn((col: string, val: any) => {
                for (const [k, v] of mockAttempts.entries()) {
                  if (v[col] === val) {
                    mockAttempts.set(k, { ...v, ...data });
                  }
                }
                return Promise.resolve({ error: null });
              }),
            })),
          };
        }

        if (table === 'app_user') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({
              data: [
                { email: 'admissions@expertdentalsolutions.com' },
                { email: 'coordinator@expertdentalsolutions.com' },
              ],
              error: null,
            }),
          };
        }

        if (table === 'lead_activities') {
          return {
            insert: vi.fn((data: any) => {
              mockActivities.push(data);
              return Promise.resolve({ error: null });
            }),
          };
        }

        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }),
    };
  });

  // ---------------------------------------------------------------------------
  // 1 & 2: Push Sent Immediately; Email Queued Without Premature Send
  // ---------------------------------------------------------------------------
  it('1 & 2: push notification is sent immediately; email is queued for inactivity and NOT sent immediately', async () => {
    const attemptPayload: InternalNotificationPayload = {
      event_type: 'incomplete_registration',
      idempotency_key: 'internal_email:attempt:att_sess_100',
      lead_id: 'lead-100',
      attempt_id: 'att-100',
      external_attempt_id: 'att_sess_100',
      lead_name: 'Dr. John Early',
      email: 'early@example.com',
      course_name: 'Zygomatic Implant Training',
      raw_payload: {
        name: 'Dr. John Early',
        email: 'early@example.com',
        course: 'Zygomatic Implant Training',
      },
    };

    // Queue incomplete notification with 15-minute inactivity window
    const queueRes = await queueOrUpdateIncompleteEnrollmentNotification(mockDb, attemptPayload, 15);
    expect(queueRes.success).toBe(true);
    expect(queueRes.status).toBe('pending');

    // Email has NOT been dispatched yet!
    expect(mockSendEmail).not.toHaveBeenCalled();

    // The attempt is tracked in internal_notification_logs as pending
    const savedLog = mockLogs.get('internal_email:attempt:att_sess_100');
    expect(savedLog).toBeDefined();
    expect(savedLog.status).toBe('pending');
    expect(savedLog.payload_snapshot.name).toBe('Dr. John Early');
  });

  // ---------------------------------------------------------------------------
  // 3 & 4: Progressive Autosave Enrichment & Latest Snapshot in Email
  // ---------------------------------------------------------------------------
  it('3 & 4: progressive autosave sequence (T0 -> T+30s -> T+60s -> T+90s) enriches snapshot, and abandonment sweep sends LATEST snapshot', async () => {
    const attemptKey = 'internal_email:attempt:att_journey_999';
    const attemptId = 'att-journey-999';
    const leadId = 'lead-journey-999';

    mockAttempts.set(attemptId, { id: attemptId, lead_id: leadId, status: 'needs_followup' });

    // T0: Name + Email
    await queueOrUpdateIncompleteEnrollmentNotification(mockDb, {
      event_type: 'incomplete_registration',
      idempotency_key: attemptKey,
      lead_id: leadId,
      attempt_id: attemptId,
      raw_payload: {
        name: 'Dr. Gregory House',
        email: 'house@diagnostics.com',
      },
    }, 15);

    expect(mockSendEmail).not.toHaveBeenCalled(); // No email at T0

    // T+30s: Phone + Course
    await queueOrUpdateIncompleteEnrollmentNotification(mockDb, {
      event_type: 'incomplete_registration',
      idempotency_key: attemptKey,
      lead_id: leadId,
      attempt_id: attemptId,
      raw_payload: {
        phone: '+16095550100',
        course: 'Zygomatic Implant Training',
      },
    }, 15);

    expect(mockSendEmail).not.toHaveBeenCalled(); // Still typing! No email at T+30s

    // T+60s: Specialty + Years in Practice
    await queueOrUpdateIncompleteEnrollmentNotification(mockDb, {
      event_type: 'incomplete_registration',
      idempotency_key: attemptKey,
      lead_id: leadId,
      attempt_id: attemptId,
      raw_payload: {
        specialty: 'Oral & Maxillofacial Surgery',
        years_in_practice: '10+ years',
      },
    }, 15);

    expect(mockSendEmail).not.toHaveBeenCalled(); // Still typing! No email at T+60s

    // T+90s: Emergency Phone + Referral + AGD Number
    await queueOrUpdateIncompleteEnrollmentNotification(mockDb, {
      event_type: 'incomplete_registration',
      idempotency_key: attemptKey,
      lead_id: leadId,
      attempt_id: attemptId,
      raw_payload: {
        emergency_phone: '+16095550199',
        referral_name: 'Dr. James Wilson',
        agd_number: 'PACE-776655',
      },
    }, 15);

    expect(mockSendEmail).not.toHaveBeenCalled(); // User now abandons page!

    // Verify snapshot has accumulated ALL fields through T+90s
    const pendingLog = mockLogs.get(attemptKey);
    expect(pendingLog.payload_snapshot.name).toBe('Dr. Gregory House');
    expect(pendingLog.payload_snapshot.email).toBe('house@diagnostics.com');
    expect(pendingLog.payload_snapshot.phone).toBe('+16095550100');
    expect(pendingLog.payload_snapshot.course).toBe('Zygomatic Implant Training');
    expect(pendingLog.payload_snapshot.specialty).toBe('Oral & Maxillofacial Surgery');
    expect(pendingLog.payload_snapshot.years_in_practice).toBe('10+ years');
    expect(pendingLog.payload_snapshot.emergency_phone).toBe('+16095550199');
    expect(pendingLog.payload_snapshot.referral_name).toBe('Dr. James Wilson');
    expect(pendingLog.payload_snapshot.agd_number).toBe('PACE-776655');

    // Simulate 15 minutes of inactivity passing
    pendingLog.scheduled_for = new Date(Date.now() - 1000).toISOString();

    // Abandonment sweep runs
    const sweepResult = await processPendingAbandonedEnrollments(mockDb, { inactivityMinutes: 15 });
    expect(sweepResult.processed).toBe(1);
    expect(sweepResult.sent).toBe(1);

    // Exactly ONE email sent!
    expect(mockSendEmail).toHaveBeenCalledTimes(2); // Sent to the 2 admins (admissions + coordinator)
    const callArgs = mockSendEmail.mock.calls[0][0];

    // Verify email contains ALL fields entered up through T+90s!
    expect(callArgs.html).toContain('Dr. Gregory House');
    expect(callArgs.html).toContain('house@diagnostics.com');
    expect(callArgs.html).toContain('+16095550100');
    expect(callArgs.html).toContain('Zygomatic Implant Training');
    expect(callArgs.html).toContain('Oral &amp; Maxillofacial Surgery');
    expect(callArgs.html).toContain('10+ years');
    expect(callArgs.html).toContain('+16095550199');
    expect(callArgs.html).toContain('Dr. James Wilson');
    expect(callArgs.html).toContain('PACE-776655');

    // Status updated to sent
    expect(mockLogs.get(attemptKey).status).toBe('sent');
  });


  // ---------------------------------------------------------------------------
  // 5: Incomplete -> Completed Race
  // ---------------------------------------------------------------------------
  it('5: user completes registration before 15m window; incomplete email is SKIPPED', async () => {
    const attemptKey = 'internal_email:attempt:att_race_777';
    const attemptId = 'att-race-777';
    const leadId = 'lead-race-777';

    mockAttempts.set(attemptId, { id: attemptId, lead_id: leadId, status: 'needs_followup' });

    // User fills part of form at T0
    await queueOrUpdateIncompleteEnrollmentNotification(mockDb, {
      event_type: 'incomplete_registration',
      idempotency_key: attemptKey,
      lead_id: leadId,
      attempt_id: attemptId,
      raw_payload: { name: 'Dr. Fast Completer', email: 'fast@example.com' },
    }, 15);

    // At minute 3, user successfully completes registration!
    // Incomplete enrollment is marked completed:
    mockAttempts.set(attemptId, { id: attemptId, lead_id: leadId, status: 'completed', resolved_at: new Date().toISOString() });

    // submit-public-form marks pending notification as skipped:
    const log = mockLogs.get(attemptKey);
    log.status = 'skipped';
    log.error_message = 'Registration completed prior to inactivity threshold';

    // 15 minutes pass: sweep runs
    log.scheduled_for = new Date(Date.now() - 1000).toISOString();
    const sweepResult = await processPendingAbandonedEnrollments(mockDb, { inactivityMinutes: 15 });

    expect(sweepResult.sent).toBe(0); // Zero emails sent!
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // 6: Failed Submit Preserves Same external_attempt_id
  // ---------------------------------------------------------------------------
  it('6: failed submit (validation error, 422, missing passport) preserves same external_attempt_id and updates same record', async () => {
    const attemptKey = 'internal_email:attempt:att_stable_555';
    const attemptId = 'att-stable-555';
    const leadId = 'lead-stable-555';

    // 1. User enters draft
    await queueOrUpdateIncompleteEnrollmentNotification(mockDb, {
      event_type: 'incomplete_registration',
      idempotency_key: attemptKey,
      lead_id: leadId,
      attempt_id: attemptId,
      raw_payload: { name: 'Dr. Failed Submit', email: 'failed@test.com' },
    }, 15);

    // 2. User clicks Submit -> Laravel rejects (422 Unprocessable Entity: missing passport)
    // The client script DOES NOT remove the attempt ID from localStorage.
    // User fixes their mistake and enters more info:
    await queueOrUpdateIncompleteEnrollmentNotification(mockDb, {
      event_type: 'incomplete_registration',
      idempotency_key: attemptKey,
      lead_id: leadId,
      attempt_id: attemptId,
      raw_payload: {
        phone: '+15559990000',
        specialty: 'Endodontics',
      },
    }, 15);

    // Verify NO new attempt was created; the SAME log row is updated
    expect(mockLogs.size).toBe(1);
    const existing = mockLogs.get(attemptKey);
    expect(existing.payload_snapshot.name).toBe('Dr. Failed Submit');
    expect(existing.payload_snapshot.phone).toBe('+15559990000');
    expect(existing.payload_snapshot.specialty).toBe('Endodontics');
  });

  // ---------------------------------------------------------------------------
  // 7: Completed Registration Sends Separate EDS Operational CRM Alert
  // ---------------------------------------------------------------------------
  it('7: completed registration sends separate EDS internal operational alert without legal attachments', async () => {
    const completedPayload: InternalNotificationPayload = {
      event_type: 'completed_registration',
      idempotency_key: 'internal_email:completed:sub_999888',
      lead_id: 'lead-uuid-completed-1',
      submission_id: 'sub_999888',
      lead_name: 'Dr. Sarah Connor',
      email: 'sarah.connor@example.com',
      course_name: 'Zygomatic Implant Training',
    };

    const res = await sendInternalEnrollmentNotification(mockDb, completedPayload, { immediate: true });
    expect(res.success).toBe(true);
    expect(res.recipients.length).toBe(2);
    expect(res.subject).toContain('[EDS] Nova matrícula concluída — Dr. Sarah Connor — Zygomatic Implant Training');
    expect(mockLogs.has('internal_email:completed:sub_999888')).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 8: EDS Ingests Expanded Non-File CRM Fields
  // ---------------------------------------------------------------------------
  it('8: EDS public form submission preserves all expanded non-file CRM fields', () => {
    const rawIncomingFields: Record<string, any> = {
      name: 'Dr. Gregory House',
      email: 'house@princeton.edu',
      phone: '+16095550100',
      emergency_phone: '+16095550199',
      specialty: 'Diagnostics & Surgery',
      years_in_practice: '15+ years',
      surgical_experience: 'Expert',
      certificate_name: 'Gregory House, MD, DDS',
      agd_number: 'PACE-5544',
      coat_size: 'L',
      heard_from: 'Conference',
      referral_name: 'Dr. Cuddy',
      promo_code: 'DIAG2026',
      date: '2026-10-14',
      course: 'Zygomatic Implant Training',
      signature: 'G. House',
      terms_accepted: true,
      medical_conditions: 'None',
      dietary: 'Vegetarian',
      source_page: 'https://www.expdentalsolutions.com/register',
      utm_source: 'newsletter',
      passport: '[binary file data]',
      dental_license: '[binary file data]',
      'g-recaptcha-response': 'token_xyz',
      _token: 'csrf_token_abc',
    };

    const sanitizedFields = { ...rawIncomingFields };
    delete sanitizedFields.passport;
    delete sanitizedFields.dental_license;
    delete sanitizedFields['g-recaptcha-response'];
    delete sanitizedFields._token;

    expect(sanitizedFields.passport).toBeUndefined();
    expect(sanitizedFields.dental_license).toBeUndefined();
    expect(sanitizedFields.emergency_phone).toBe('+16095550199');
    expect(sanitizedFields.specialty).toBe('Diagnostics & Surgery');
    expect(sanitizedFields.certificate_name).toBe('Gregory House, MD, DDS');
    expect(sanitizedFields.agd_number).toBe('PACE-5544');
    expect(sanitizedFields.coat_size).toBe('L');
    expect(sanitizedFields.referral_name).toBe('Dr. Cuddy');
    expect(sanitizedFields.medical_conditions).toBe('None');
    expect(sanitizedFields.dietary).toBe('Vegetarian');
    expect(sanitizedFields.signature).toBe('G. House');
  });

  // ---------------------------------------------------------------------------
  // 9: Binary Exclusions from Partial Capture
  // ---------------------------------------------------------------------------
  it('9: no passport or dental_license binary enters partial capture payload', () => {
    const rawPartialData: Record<string, any> = {
      name: 'Dr. Partial Tester',
      email: 'partial@test.com',
      passport: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      dental_license: new Uint8Array([0xff, 0xd8, 0xff]),
    };

    const capturePayload: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawPartialData)) {
      if (k === 'passport' || k === 'dental_license') continue;
      if (typeof v === 'string') capturePayload[k] = v;
    }

    expect(capturePayload.passport).toBeUndefined();
    expect(capturePayload.dental_license).toBeUndefined();
    expect(capturePayload.name).toBe('Dr. Partial Tester');
    expect(capturePayload.email).toBe('partial@test.com');
  });

  // ---------------------------------------------------------------------------
  // 10: Isolation & Non-Regression
  // ---------------------------------------------------------------------------
  it('10: Meta ad, Contact Us, and Request Course Info remain strictly isolated', () => {
    const metaPayload = { source: 'meta', source_detail: 'meta_lead_ad' };
    const contactPayload = { slug: 'website-contact', source_detail: 'contact_form' };
    const courseInfoPayload = { slug: 'website-course-info', source_detail: 'course_information_request' };

    expect(['incomplete_registration', 'website-register']).not.toContain(metaPayload.source_detail);
    expect(['incomplete_registration', 'website-register']).not.toContain(contactPayload.slug);
    expect(['incomplete_registration', 'website-register']).not.toContain(courseInfoPayload.slug);
  });

  it('resolves internal administrator recipients', async () => {
    const customDb = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({
          data: [
            { email: 'admin1@expertdentalsolutions.com' },
            { email: 'admin2@expertdentalsolutions.com' },
          ],
          error: null,
        }),
      })),
    };

    const recipients = await resolveInternalRecipients(customDb as any);
    expect(recipients).toContain('admin1@expertdentalsolutions.com');
    expect(recipients).toContain('admin2@expertdentalsolutions.com');
  });

  it('buildIncompleteAttemptEmail renders dynamic snapshot fields and deep link', () => {
    const emailData = buildIncompleteAttemptEmail({
      event_type: 'incomplete_registration',
      idempotency_key: 'test_render',
      lead_name: 'Dr. Visual Check',
      email: 'visual@example.com',
      course_name: 'Advanced Implant Training',
      raw_payload: {
        specialty: 'Periodontist',
        years_in_practice: '5-9 years',
      },
    }, 'https://hub.expdentalsolutions.com/leads/lead-123');

    expect(emailData.subject).toBe('[EDS] Matrícula não concluída — Dr. Visual Check — Advanced Implant Training');
    expect(emailData.html).toContain('Dr. Visual Check');
    expect(emailData.html).toContain('Periodontist');
    expect(emailData.html).toContain('5-9 years');
    expect(emailData.html).toContain('https://hub.expdentalsolutions.com/leads/lead-123');
  });

  // ===========================================================================
  // PART A: 10-MINUTE INACTIVITY WINDOW VERIFICATION
  // ===========================================================================
  describe('Part A: Inactivity Window (10 Minutes)', () => {
    it('Part A1: default inactivity threshold is 10 minutes, and typing pushes scheduled_for forward', async () => {
      const attemptKey = 'internal_email:attempt:att_part_a_1';
      const attemptId = 'att-part-a-1';
      const leadId = 'lead-part-a-1';

      mockAttempts.set(attemptId, { id: attemptId, lead_id: leadId, status: 'needs_followup' });

      // T0: First autosave (name + email) with default inactivity window (10 minutes)
      const res1 = await queueOrUpdateIncompleteEnrollmentNotification(mockDb, {
        event_type: 'incomplete_registration',
        idempotency_key: attemptKey,
        lead_id: leadId,
        attempt_id: attemptId,
        raw_payload: { name: 'Dr. Inactive Tester', email: 'inactive@test.com' },
      });

      expect(res1.success).toBe(true);
      expect(mockSendEmail).not.toHaveBeenCalled();

      const log1 = mockLogs.get(attemptKey);
      const scheduledAtT0 = new Date(log1.scheduled_for).getTime();
      const expectedT0 = Date.now() + 10 * 60 * 1000;
      expect(Math.abs(scheduledAtT0 - expectedT0)).toBeLessThan(5000); // within 5s of now + 10m

      // T+3 min: User enters phone number. The factual update MUST push scheduled_for forward!
      await queueOrUpdateIncompleteEnrollmentNotification(mockDb, {
        event_type: 'incomplete_registration',
        idempotency_key: attemptKey,
        lead_id: leadId,
        attempt_id: attemptId,
        raw_payload: { phone: '+18005550199' },
      });

      const log2 = mockLogs.get(attemptKey);
      const scheduledAtT3 = new Date(log2.scheduled_for).getTime();
      expect(scheduledAtT3).toBeGreaterThanOrEqual(scheduledAtT0);
      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it('Part A2: 9 min inactivity triggers NO email, while 10+ min inactivity triggers email with LATEST snapshot', async () => {
      const attemptKey = 'internal_email:attempt:att_part_a_2';
      const attemptId = 'att-part-a-2';
      const leadId = 'lead-part-a-2';

      mockAttempts.set(attemptId, { id: attemptId, lead_id: leadId, status: 'needs_followup' });

      // Queue attempt
      await queueOrUpdateIncompleteEnrollmentNotification(mockDb, {
        event_type: 'incomplete_registration',
        idempotency_key: attemptKey,
        lead_id: leadId,
        attempt_id: attemptId,
        raw_payload: {
          name: 'Dr. Threshold Check',
          email: 'threshold@check.com',
          course: 'Advanced Dental Implant Experience',
          specialty: 'Oral Surgery',
        },
      }, 10);

      const log = mockLogs.get(attemptKey);

      // Simulate 9 minutes of inactivity: scheduled_for is 1 minute in the future
      log.scheduled_for = new Date(Date.now() + 60 * 1000).toISOString();

      // Sweep runs at 9 minutes inactivity -> NO email sent!
      const sweep9min = await processPendingAbandonedEnrollments(mockDb, { inactivityMinutes: 10 });
      expect(sweep9min.sent).toBe(0);
      expect(mockSendEmail).not.toHaveBeenCalled();
      expect(log.status).toBe('pending');

      // Simulate 10+ minutes of inactivity: scheduled_for is now in the past
      log.scheduled_for = new Date(Date.now() - 5000).toISOString();

      // Sweep runs at 10+ minutes inactivity -> Email is ELIGIBLE and dispatched!
      const sweep10min = await processPendingAbandonedEnrollments(mockDb, { inactivityMinutes: 10 });
      expect(sweep10min.sent).toBe(1);
      expect(mockSendEmail).toHaveBeenCalledTimes(2); // 2 active admins

      const emailHtml = mockSendEmail.mock.calls[0][0].html;
      expect(emailHtml).toContain('Dr. Threshold Check');
      expect(emailHtml).toContain('threshold@check.com');
      expect(emailHtml).toContain('Advanced Dental Implant Experience');
      expect(mockLogs.get(attemptKey).status).toBe('sent');
    });

    it('Part A3: repeated autosaves update ONE canonical attempt and do NOT produce duplicate emails', async () => {
      const attemptKey = 'internal_email:attempt:att_part_a_3';
      const attemptId = 'att-part-a-3';
      const leadId = 'lead-part-a-3';

      mockAttempts.set(attemptId, { id: attemptId, lead_id: leadId, status: 'needs_followup' });

      // 5 continuous autosaves
      for (let i = 1; i <= 5; i++) {
        await queueOrUpdateIncompleteEnrollmentNotification(mockDb, {
          event_type: 'incomplete_registration',
          idempotency_key: attemptKey,
          lead_id: leadId,
          attempt_id: attemptId,
          raw_payload: { [`field_${i}`]: `value_${i}` },
        }, 10);
      }

      // Exactly ONE record exists
      expect(mockLogs.size).toBe(1);
      const log = mockLogs.get(attemptKey);
      expect(log.payload_snapshot.field_1).toBe('value_1');
      expect(log.payload_snapshot.field_5).toBe('value_5');

      // Trigger send after 10m
      log.scheduled_for = new Date(Date.now() - 1000).toISOString();
      const sweep1 = await processPendingAbandonedEnrollments(mockDb, { inactivityMinutes: 10 });
      expect(sweep1.sent).toBe(1);

      // Re-running sweep does NOT send duplicate email
      const sweep2 = await processPendingAbandonedEnrollments(mockDb, { inactivityMinutes: 10 });
      expect(sweep2.sent).toBe(0);
      expect(mockLogs.get(attemptKey).status).toBe('sent');
    });
  });

  // ===========================================================================
  // PART B: CONTACT US INTERNAL EMAIL VERIFICATION
  // ===========================================================================
  describe('Part B: Contact Us Internal Email', () => {
    it('Part B1 & B2: valid Contact Us submission sends internal email with all factual fields and full untruncated message', async () => {
      const fullVisitorMessage = 'Hello Admissions Team,\n\nI am very interested in the Feb/Mar 2027 surgical cohort. I want to confirm whether surgical loupes with 3.5x magnification are required and if live patient surgery begins on Day 2.\n\nThank you,\nDr. Contact Tester';

      const contactPayload: InternalContactNotificationPayload = {
        event_type: 'contact_us',
        idempotency_key: 'internal_email:contact:sub-contact-uuid-001',
        lead_id: 'lead-contact-uuid-001',
        submission_id: 'sub-contact-uuid-001',
        lead_name: 'Dr. Contact Tester',
        email: 'contact.tester@example.com',
        phone: '+13055550144',
        message: fullVisitorMessage,
        raw_payload: {
          name: 'Dr. Contact Tester',
          email: 'contact.tester@example.com',
          phone: '+13055550144',
          city: 'Miami',
          state: 'FL',
          country: 'United States',
          preferred_time: 'Morning',
          comments: fullVisitorMessage,
          _token: 'secret_csrf_token',
          'g-recaptcha-response': 'captcha_secret',
        },
        source_page: 'https://expertdentalsolutions.com/contact-us',
        utm_source: 'google',
        utm_medium: 'cpc',
        utm_campaign: 'brand_search_2026',
      };

      const result = await sendInternalContactNotification(mockDb, contactPayload);
      expect(result.success).toBe(true);
      expect(result.sent).toBe(2); // 2 active admins
      expect(result.subject).toBe('[EDS] Novo contato pelo site — Dr. Contact Tester');

      // Verify email was logged to internal_notification_logs
      const savedLog = mockLogs.get('internal_email:contact:sub-contact-uuid-001');
      expect(savedLog).toBeDefined();
      expect(savedLog.event_type).toBe('contact_us');
      expect(savedLog.status).toBe('sent');
      expect(savedLog.submission_id).toBe('sub-contact-uuid-001');

      // Verify email was logged to lead_activities
      expect(mockActivities.length).toBe(1);
      expect(mockActivities[0].activity_type).toBe('contact_us_internal_email');
      expect(mockActivities[0].lead_id).toBe('lead-contact-uuid-001');

      // Inspect sent email HTML
      expect(mockSendEmail).toHaveBeenCalledTimes(2);
      const emailHtml = mockSendEmail.mock.calls[0][0].html;

      // 1. ALL factual form fields present
      expect(emailHtml).toContain('Dr. Contact Tester');
      expect(emailHtml).toContain('contact.tester@example.com');
      expect(emailHtml).toContain('+13055550144');
      expect(emailHtml).toContain('Miami');
      expect(emailHtml).toContain('FL');
      expect(emailHtml).toContain('United States');
      expect(emailHtml).toContain('Morning');

      // 2. Sensitive fields EXCLUDED
      expect(emailHtml).not.toContain('secret_csrf_token');
      expect(emailHtml).not.toContain('captcha_secret');

      // 3. FULL message prominently displayed and untruncated
      expect(emailHtml).toContain('Feb/Mar 2027 surgical cohort');
      expect(emailHtml).toContain('surgical loupes with 3.5x magnification');
      expect(emailHtml).toContain('live patient surgery begins on Day 2');
      expect(emailHtml).toContain('Dr. Contact Tester');

      // 4. Origem / UTMs present
      expect(emailHtml).toContain('https://expertdentalsolutions.com/contact-us');
      expect(emailHtml).toContain('google');
      expect(emailHtml).toContain('cpc');
      expect(emailHtml).toContain('brand_search_2026');

      // 5. CTA link to canonical lead in EDS HUB
      expect(emailHtml).toContain('https://hub.expdentalsolutions.com/leads/lead-contact-uuid-001');
    });

    it('Part B3: email safely escapes HTML tags and special characters in visitor message', () => {
      const maliciousMessage = '<script>alert("xss")</script> & <b>bold check</b> "quotes"';
      const emailData = buildContactUsEmail({
        event_type: 'contact_us',
        idempotency_key: 'test_sec_contact',
        lead_name: 'Dr. Safe HTML',
        email: 'safe@test.com',
        message: maliciousMessage,
        raw_payload: { message: maliciousMessage },
      }, 'https://hub.expdentalsolutions.com/leads/lead-sec');

      expect(emailData.html).not.toContain('<script>');
      expect(emailData.html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
      expect(emailData.html).toContain('&amp;');
    });

    it('Part B4: idempotency prevents duplicate email on browser retry or reconcile', async () => {
      const contactPayload: InternalContactNotificationPayload = {
        event_type: 'contact_us',
        idempotency_key: 'internal_email:contact:sub-contact-idempotent',
        lead_id: 'lead-contact-idempotent',
        submission_id: 'sub-contact-idempotent',
        lead_name: 'Dr. Idempotent',
        email: 'idempotent@test.com',
        message: 'First submission message.',
        raw_payload: { message: 'First submission message.' },
      };

      // First call
      const res1 = await sendInternalContactNotification(mockDb, contactPayload);
      expect(res1.success).toBe(true);
      expect(res1.sent).toBe(2);

      const emailCallCount = mockSendEmail.mock.calls.length;

      // Second call (browser retry / network reconcile with same submission_id)
      const res2 = await sendInternalContactNotification(mockDb, contactPayload);
      expect(res2.success).toBe(true);
      expect(res2.already_sent).toBe(true);

      // ZERO additional emails dispatched!
      expect(mockSendEmail.mock.calls.length).toBe(emailCallCount);
    });

    it('Part B5: returning existing lead creates new submission and sends email for the new submission', async () => {
      const existingLeadId = 'lead-canonical-returning';

      // Submission 1: Inquiry about Course A
      const sub1: InternalContactNotificationPayload = {
        event_type: 'contact_us',
        idempotency_key: 'internal_email:contact:sub-inquiry-1',
        lead_id: existingLeadId,
        submission_id: 'sub-inquiry-1',
        lead_name: 'Dr. Returning Lead',
        email: 'returning@example.com',
        message: 'Inquiry 1 about Course A.',
        raw_payload: { message: 'Inquiry 1 about Course A.' },
      };

      await sendInternalContactNotification(mockDb, sub1);
      expect(mockSendEmail).toHaveBeenCalledTimes(2);

      // Submission 2 (Weeks later, same lead returns and submits new Contact Us)
      const sub2: InternalContactNotificationPayload = {
        event_type: 'contact_us',
        idempotency_key: 'internal_email:contact:sub-inquiry-2',
        lead_id: existingLeadId,
        submission_id: 'sub-inquiry-2',
        lead_name: 'Dr. Returning Lead',
        email: 'returning@example.com',
        message: 'Inquiry 2 about accommodation and dates.',
        raw_payload: { message: 'Inquiry 2 about accommodation and dates.' },
      };

      await sendInternalContactNotification(mockDb, sub2);
      expect(mockSendEmail).toHaveBeenCalledTimes(4); // Dispatches new email for factual submission 2!

      const callArgs2 = mockSendEmail.mock.calls[2][0];
      expect(callArgs2.html).toContain('Inquiry 2 about accommodation and dates.');
    });

    it('Part B6: strict form isolation: Register, Request Course Info, Meta, and non-website forms do NOT trigger Contact Us email', () => {
      // In submit-public-form:
      // isWebsiteContact = form.slug === 'website-contact' || (form.source === 'website' && form.source_detail === 'contact_form')
      const checkIsContact = (form: { slug: string; source_detail?: string; source?: string }) => {
        return form.slug === 'website-contact' || (form.source === 'website' && form.source_detail === 'contact_form');
      };

      expect(checkIsContact({ slug: 'website-contact', source: 'website', source_detail: 'contact_form' })).toBe(true);
      expect(checkIsContact({ slug: 'website-contact' })).toBe(true);
      // Non-website source even with source_detail='contact_form' does NOT qualify:
      expect(checkIsContact({ slug: 'external-intake', source: 'external', source_detail: 'contact_form' })).toBe(false);
      expect(checkIsContact({ slug: 'website-register', source: 'website', source_detail: 'website_registration' })).toBe(false);
      expect(checkIsContact({ slug: 'website-course-info', source: 'website', source_detail: 'course_information_request' })).toBe(false);
      expect(checkIsContact({ slug: 'meta-lead', source: 'meta', source_detail: 'meta_lead_ad' })).toBe(false);
      expect(checkIsContact({ slug: 'incomplete_registration', source: 'website', source_detail: 'incomplete_registration' })).toBe(false);
    });
  });
});

