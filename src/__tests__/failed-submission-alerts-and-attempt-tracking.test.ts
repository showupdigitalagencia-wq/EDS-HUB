// =============================================================================
// Unit & Integration Tests: Failed Submission Alerts, Diagnostics & Attempt Tracking
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildIncompleteAttemptEmail,
  sendInternalEnrollmentNotification,
  queueOrUpdateIncompleteEnrollmentNotification,
  processPendingAbandonedEnrollments,
  type InternalNotificationPayload,
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

describe('Failed Submission Alerts & Attempt Tracking Audit', () => {
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
                or: vi.fn((clause: string) => {
                  queryObj._filters.push((item: any) => {
                    // Check if clause matches idempotency_key or external_attempt_id
                    if (clause.includes('fail_') && item.idempotency_key && item.idempotency_key.includes('fail_')) {
                      return true;
                    }
                    if (clause.includes('payload_snapshot->>external_attempt_id.eq.')) {
                      const target = clause.split('.eq.')[1]?.split(',')[0];
                      return item.payload_snapshot?.external_attempt_id === target;
                    }
                    return false;
                  });
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
              return Promise.resolve({ data: row, error: null });
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
                return {
                  eq: vi.fn((c2: string, v2: any) => {
                    for (const [k, v] of mockLogs.entries()) {
                      if (v[col] === val && v[c2] === v2) {
                        mockLogs.set(k, { ...v, ...data });
                      }
                    }
                    return Promise.resolve({ error: null });
                  }),
                  or: vi.fn((_clause: string) => Promise.resolve({ error: null })),
                  then: (resolve: any) => resolve({ error: null }),
                };
              }),
            })),
          };
        }

        if (table === 'incomplete_enrollments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn((_col: string, val: any) => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: mockAttempts.get(val) || null,
                  error: null,
                }),
              })),
            })),
            update: vi.fn((data: any) => ({
              eq: vi.fn((_col: string, val: any) => {
                const existing = mockAttempts.get(val);
                if (existing) {
                  mockAttempts.set(val, { ...existing, ...data });
                }
                return Promise.resolve({ error: null });
              }),
            })),
          };
        }

        if (table === 'lead_activities') {
          return {
            insert: vi.fn((activity: any) => {
              mockActivities.push(activity);
              return Promise.resolve({ error: null });
            }),
          };
        }

        if (table === 'app_user') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({
                data: [{ email: 'admissions@expdentalsolutions.com' }],
                error: null,
              }),
            })),
          };
        }

        if (table === 'form_submissions' || table === 'enrollments') {
          return {
            select: vi.fn(() => {
              const q: any = {
                eq: vi.fn().mockReturnThis(),
                or: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                then: (resolve: any) => resolve({ data: [], error: null }),
              };
              return q;
            }),
          };
        }

        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          insert: vi.fn().mockResolvedValue({ error: null }),
          update: vi.fn().mockResolvedValue({ error: null }),
        };
      }),
    };
  });

  // ---------------------------------------------------------------------------
  // 1. Explicit Failed Submit sends IMMEDIATE internal email (Subject, Badge, Content)
  // ---------------------------------------------------------------------------
  it('sends IMMEDIATE internal email with subject "[EDS] Tentativa de matrícula — {Name} — {Course}" upon factual failed submission', async () => {
    const payload: InternalNotificationPayload = {
      event_type: 'incomplete_registration',
      idempotency_key: 'internal_email:attempt:fail_att_user_001_1',
      lead_id: 'lead-100',
      attempt_id: 'att-100',
      external_attempt_id: 'att_user_001',
      lead_name: 'Dr. John Doe',
      first_name: 'John',
      last_name: 'Doe',
      email: 'john.doe@example.com',
      phone: '+1 (555) 234-5678',
      course_name: 'Intensive Dental Implant Training',
      course_code: 'IDIT-01',
      status: 'submission_failed',
      failure_category: 'Passport ausente',
      submit_attempt_count: 1,
      raw_payload: {
        emergency_phone: '+1 (555) 999-8888',
        specialty: 'General Dentist',
        years_in_practice: '5-10 years',
        surgical_experience: 'Intermediate',
        coat_size: 'L',
        heard_from: 'Google Search',
        referral_name: 'Dr. Smith',
        promo_code: 'EDS2026',
        certificate_name: 'John Doe, DDS',
        agd_number: '123456',
        failure_category: 'Passport ausente',
        submit_attempt_count: 1,
      },
    };

    // Notice we do NOT pass { immediate: true } — the function must detect status === 'submission_failed' and send immediately!
    const result = await sendInternalEnrollmentNotification(mockDb, payload);

    expect(result.success).toBe(true);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);

    const callArgs = mockSendEmail.mock.calls[0][0];
    expect(callArgs.to).toBe('admissions@expdentalsolutions.com');
    expect(callArgs.subject).toBe('[EDS] Tentativa de matrícula — Dr. John Doe — Intensive Dental Implant Training');
    expect(callArgs.html).toContain('Falha no Envio');
    expect(callArgs.html).toContain('Motivo da falha: Passport ausente');
    expect(callArgs.html).toContain('Dr. John Doe');
    expect(callArgs.html).toContain('Intensive Dental Implant Training');
    expect(callArgs.html).toContain('John Doe, DDS');
    expect(callArgs.html).toContain('Tamanho do Jaleco');
    expect(callArgs.html).toContain('L');
    expect(callArgs.html).toContain('123456');

    // Confirm stored in logs as 'sent'
    const stored = mockLogs.get('internal_email:attempt:fail_att_user_001_1');
    expect(stored).toBeDefined();
    expect(stored.status).toBe('sent');
  });

  // ---------------------------------------------------------------------------
  // 2. Repeated Failed Submissions: Plural Subject & Count Tracking
  // ---------------------------------------------------------------------------
  it('formats repeated attempts as "[EDS] {N} tentativas de matrícula — {Name} — {Course}"', () => {
    const payloadAttempt2: InternalNotificationPayload = {
      event_type: 'incomplete_registration',
      idempotency_key: 'internal_email:attempt:fail_att_user_001_2',
      lead_name: 'Dr. Maria Santos',
      email: 'maria@example.com',
      phone: '+55 11 98765-4321',
      course_name: 'Endodontics Training',
      status: 'submission_failed',
      failure_category: 'Campos obrigatórios ausentes',
      submit_attempt_count: 2,
      raw_payload: {
        submit_attempt_count: 2,
        failure_category: 'Campos obrigatórios ausentes',
      },
    };

    const emailAttempt2 = buildIncompleteAttemptEmail(payloadAttempt2, 'https://hub.expdentalsolutions.com/leads/123');
    expect(emailAttempt2.subject).toBe('[EDS] 2 tentativas de matrícula — Dr. Maria Santos — Endodontics Training');
    expect(emailAttempt2.html).toContain('2 tentativas de matrícula com falha');
    expect(emailAttempt2.html).toContain('Falha no Envio (2ª tentativa)');
    expect(emailAttempt2.html).toContain('Campos obrigatórios ausentes');
    expect(emailAttempt2.html).toContain('2 tentativas');
    expect(emailAttempt2.text).toContain('Tentativas: 2');

    const payloadAttempt3: InternalNotificationPayload = {
      ...payloadAttempt2,
      submit_attempt_count: 3,
      raw_payload: { submit_attempt_count: 3, failure_category: 'Dental License ausente' },
    };
    const emailAttempt3 = buildIncompleteAttemptEmail(payloadAttempt3, 'https://hub.expdentalsolutions.com/leads/123');
    expect(emailAttempt3.subject).toBe('[EDS] 3 tentativas de matrícula — Dr. Maria Santos — Endodontics Training');
    expect(emailAttempt3.html).toContain('Falha no Envio (3ª tentativa)');
  });

  // ---------------------------------------------------------------------------
  // 3. Inactivity Abandonment (10 min) preserves "[EDS] Matrícula não concluída"
  // ---------------------------------------------------------------------------
  it('preserves "[EDS] Matrícula não concluída — {Name} — {Course}" for 10-minute abandonment', () => {
    const abandonmentPayload: InternalNotificationPayload = {
      event_type: 'incomplete_registration',
      idempotency_key: 'internal_email:attempt:att_abandon_99',
      lead_name: 'Dr. Jane Miller',
      email: 'jane@example.com',
      phone: '+1 555-444-3333',
      course_name: 'Wisdom Teeth Training',
      status: 'needs_followup', // NOT submission_failed
      raw_payload: {},
    };

    const email = buildIncompleteAttemptEmail(abandonmentPayload, 'https://hub.expdentalsolutions.com/leads/99');
    expect(email.subject).toBe('[EDS] Matrícula não concluída — Dr. Jane Miller — Wisdom Teeth Training');
    expect(email.html).toContain('Tentativa Incompleta');
    expect(email.html).toContain('Tentativa de matrícula pendente de finalização');
    expect(email.html).toContain('#f59e0b'); // amber accent
  });

  // ---------------------------------------------------------------------------
  // 4. De-duplication: Failed submit immediate alert cancels pending 10-min abandonment
  // ---------------------------------------------------------------------------
  it('cancels pending abandonment notification when an immediate failed submit occurs for the same attempt', async () => {
    const extAttemptId = 'att_session_xyz';

    // 1. Visitor starts typing -> queues abandonment for +10 min
    const inactPayload: InternalNotificationPayload = {
      event_type: 'incomplete_registration',
      idempotency_key: `internal_email:attempt:${extAttemptId}`,
      external_attempt_id: extAttemptId,
      lead_name: 'Dr. Alice Cooper',
      email: 'alice@example.com',
      phone: '+1 555 111 2222',
      course_name: 'Zygomatic Implant Training',
      status: 'needs_followup',
      raw_payload: { external_attempt_id: extAttemptId },
    };

    const queueRes = await queueOrUpdateIncompleteEnrollmentNotification(mockDb, inactPayload, 10);
    expect(queueRes.status).toBe('pending');

    const pendingRow = mockLogs.get(`internal_email:attempt:${extAttemptId}`);
    expect(pendingRow).toBeDefined();
    expect(pendingRow.status).toBe('pending');

    // 2. Visitor clicks Submit 2 minutes later -> Laravel rejects (422) -> Immediate failed submit dispatch
    const failedPayload: InternalNotificationPayload = {
      event_type: 'incomplete_registration',
      idempotency_key: `internal_email:attempt:fail_${extAttemptId}_1`,
      external_attempt_id: extAttemptId,
      lead_name: 'Dr. Alice Cooper',
      email: 'alice@example.com',
      phone: '+1 555 111 2222',
      course_name: 'Zygomatic Implant Training',
      status: 'submission_failed',
      failure_category: 'Passport ausente',
      submit_attempt_count: 1,
      raw_payload: { external_attempt_id: extAttemptId, failure_category: 'Passport ausente' },
    };

    const failRes = await sendInternalEnrollmentNotification(mockDb, failedPayload);
    expect(failRes.success).toBe(true);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);

    // 3. Verify the pending abandonment row was automatically marked 'skipped'
    const updatedAbandonment = mockLogs.get(`internal_email:attempt:${extAttemptId}`);
    expect(updatedAbandonment.status).toBe('skipped');
    expect(updatedAbandonment.error_message).toContain('Subsumed by immediate failed submission notification');

    // 4. Now simulate the sweeper cron running 10 minutes later:
    // Even if it was somehow queried, processPendingAbandonedEnrollments skips it!
    const sweepRes = await processPendingAbandonedEnrollments(mockDb);
    expect(sweepRes.sent).toBe(0);
    // Total emails sent across the entire lifecycle remains EXACTLY 1!
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // 5. Throttling of repeated failed submissions prevents inbox flooding
  // ---------------------------------------------------------------------------
  it('throttles rapid repeated failed submissions within 5 minutes on the same attempt', async () => {
    const extAttemptId = 'att_session_repeat';
    const basePayload: InternalNotificationPayload = {
      event_type: 'incomplete_registration',
      idempotency_key: `internal_email:attempt:fail_${extAttemptId}`,
      external_attempt_id: extAttemptId,
      lead_name: 'Dr. Robert FastClicker',
      email: 'robert@example.com',
      phone: '+1 555 888 9999',
      course_name: 'Intensive Dental Implant Training',
      status: 'submission_failed',
      failure_category: 'Validation error',
      submit_attempt_count: 1,
      raw_payload: { external_attempt_id: extAttemptId, submit_attempt_count: 1 },
    };

    // 1st click: dispatches immediately
    const res1 = await sendInternalEnrollmentNotification(mockDb, basePayload);
    expect(res1.success).toBe(true);
    expect(res1.duplicate).toBeFalsy();
    expect(mockSendEmail).toHaveBeenCalledTimes(1);

    // 2nd click 5 seconds later (same attempt key): throttled!
    const payloadAttempt2 = {
      ...basePayload,
      submit_attempt_count: 2,
      raw_payload: { external_attempt_id: extAttemptId, submit_attempt_count: 2 },
    };
    const res2 = await sendInternalEnrollmentNotification(mockDb, payloadAttempt2);
    expect(res2.success).toBe(true);
    expect(res2.duplicate).toBe(true);
    expect(res2.skipped).toBe(true);
    // Email count must NOT increase!
    expect(mockSendEmail).toHaveBeenCalledTimes(1);

    // Verify snapshot was updated with attempt count = 2
    const log = mockLogs.get(`internal_email:attempt:fail_${extAttemptId}`);
    expect(log.payload_snapshot?.submit_attempt_count).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // 6. Success After Failure: Pending alerts skipped and no duplicate email
  // ---------------------------------------------------------------------------
  it('skips incomplete notifications when registration is completed after initial failure', async () => {
    const extAttemptId = 'att_session_fix_errors';
    mockAttempts.set('attempt_fix_1', {
      id: 'attempt_fix_1',
      status: 'completed',
      resolved_at: new Date().toISOString(),
      external_attempt_id: extAttemptId,
    });

    const pendingLog = {
      id: 'log_abandon_fix',
      event_type: 'incomplete_registration',
      idempotency_key: `internal_email:attempt:${extAttemptId}`,
      attempt_id: 'attempt_fix_1',
      status: 'pending',
      recipient_emails: ['admissions@expdentalsolutions.com'],
      scheduled_for: new Date(Date.now() - 1000).toISOString(),
      payload_snapshot: { external_attempt_id: extAttemptId },
    };
    mockLogs.set(pendingLog.idempotency_key, pendingLog);

    const sweepResult = await processPendingAbandonedEnrollments(mockDb);
    expect(sweepResult.skipped).toBe(1);
    expect(sweepResult.sent).toBe(0);
    expect(mockSendEmail).not.toHaveBeenCalled();

    const updatedLog = mockLogs.get(pendingLog.idempotency_key);
    expect(updatedLog.status).toBe('skipped');
    expect(updatedLog.error_message).toContain('Registration completed prior to abandonment dispatch');
  });

  // ---------------------------------------------------------------------------
  // 7. Sensitive Fields Protection: binary and passwords never leaked
  // ---------------------------------------------------------------------------
  it('excludes sensitive tokens, binaries, and medical notes from email rendering', () => {
    const payloadWithSensitiveData: InternalNotificationPayload = {
      event_type: 'incomplete_registration',
      idempotency_key: 'internal_email:attempt:fail_sec_01',
      lead_name: 'Dr. Test Security',
      email: 'sec@example.com',
      phone: '+1 555-000-1111',
      course_name: 'Intensive Dental Implant Training',
      status: 'submission_failed',
      failure_category: 'Passport ausente',
      raw_payload: {
        csrf_token: 'secret_csrf_12345',
        g_recaptcha_response: '03AFcWeA_token_abc',
        medical_conditions: 'Allergic to penicillin and hypertension',
        dietary: 'Vegetarian gluten-free',
        passport_file: 'binary_data_stream_xyz',
      },
    };

    const email = buildIncompleteAttemptEmail(payloadWithSensitiveData, 'https://hub.expdentalsolutions.com/leads/sec');
    expect(email.html).not.toContain('secret_csrf_12345');
    expect(email.html).not.toContain('03AFcWeA_token_abc');
    expect(email.html).not.toContain('Allergic to penicillin');
    expect(email.html).not.toContain('Vegetarian');
    expect(email.html).not.toContain('binary_data_stream_xyz');
  });
});
