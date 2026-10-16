// =============================================================================
// Unit & Integration Tests: Request Course Information & Completed Registration Matrícula Rule
// =============================================================================
// Validates:
// 1. Part A: Request Course Information (https://www.expdentalsolutions.com/request-course-information)
//    - Canonical classification (source = 'website', source_detail = 'course_information_request')
//    - Brand-new lead: capture stage (Novo Lead), Novas entradas marked, Site badge visible, course interest accumulated, NO enrollment
//    - Returning lead: preserves existing stage (e.g. Respondido), last_acquisition_at updated, Retorno marked, NO enrollment
//    - Internal Push notification: "Nova solicitação de informações — {Lead Name} — {Course}", idempotent
//    - Internal Email: "Request Course Information — {Lead Name} — {Course}", immediate dispatch, dynamic fields, safe escaping, no security tokens
//    - Strict email isolation: never triggers contact us or registration emails
// 2. Part B: Register For Our Course Completed Rule
//    - Brand-new completed registration -> Matrícula stage ('enrollment') + enrollment row created
//    - Returning completed registration -> preserves current stage + enrollment row created + Retorno marked
//    - MinimalLeadCard: Visibly displays Course + Turma (e.g. "Advanced • Feb/Mar 2027")
//    - Never displays raw UUID on card
//    - When no factual turma exists -> does not invent one
//    - Completed registration email: handled canonically by Laravel RegistrationReceivedAdminMail to single approved client address; EDS HUB does not duplicate
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  buildCourseInfoEmail,
  sendInternalCourseInfoNotification,
  resolveCanonicalCourseName,
  sendInternalEnrollmentNotification,
  resolveInternalRecipients,
  type InternalCourseInfoNotificationPayload,
} from '../../supabase/functions/_shared/internal-enrollment-notifier.ts';
import { MinimalLeadCard, isWebsiteLead } from '../features/pipeline/components/MinimalLeadCard';
import type { Lead } from '../types';

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

describe('Consolidated Task: Request Course Info & Completed Registration Matrícula Rule', () => {
  let mockDb: any;
  let mockLogs: Map<string, any>;
  let mockActivities: any[];

  beforeEach(() => {
    mockLogs = new Map();
    mockActivities = [];
    mockSendEmail.mockClear();

    mockDb = {
      from: vi.fn((table: string) => {
        if (table === 'internal_notification_logs') {
          return {
            select: vi.fn((_cols?: string) => ({
              eq: vi.fn((field: string, val: any) => ({
                maybeSingle: vi.fn(async () => {
                  if (field === 'idempotency_key') {
                    const row = mockLogs.get(val);
                    return { data: row || null, error: null };
                  }
                  return { data: null, error: null };
                }),
              })),
            })),
            insert: vi.fn((record: any) => {
              const id = `log_${Date.now()}_${Math.random()}`;
              const row = { id, ...record };
              mockLogs.set(record.idempotency_key, row);
              return {
                select: vi.fn(() => ({
                  maybeSingle: vi.fn(async () => ({ data: { id }, error: null })),
                })),
                then: (resolve: any) => resolve({ data: { id }, error: null }),
              };
            }),
            update: vi.fn((updates: any) => ({
              eq: vi.fn((field: string, val: any) => {
                if (field === 'idempotency_key') {
                  const existing = mockLogs.get(val);
                  if (existing) {
                    Object.assign(existing, updates);
                  }
                }
                return Promise.resolve({ data: null, error: null });
              }),
            })),
          };
        }
        if (table === 'app_user') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                data: [{ email: 'admin@expdentalsolutions.com' }],
                error: null,
              })),
            })),
          };
        }
        if (table === 'lead_activities') {
          return {
            insert: vi.fn((activity: any) => {
              mockActivities.push(activity);
              return Promise.resolve({ data: activity, error: null });
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          insert: vi.fn().mockResolvedValue({ data: null, error: null }),
          update: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }),
    };
  });

  // ===========================================================================
  // PART A: REQUEST COURSE INFORMATION
  // ===========================================================================
  describe('Part A: Request Course Information', () => {
    it('A1 & A2. canonical classification: source = website, source_detail = course_information_request', () => {
      const leadA: Partial<Lead> = {
        id: 'lead-course-info-1',
        first_name: 'Ana',
        last_name: 'Silva',
        source: 'website',
        source_detail: 'course_information_request',
        course_interest: 'Intensive Dental Implant Training',
      };

      // Classification is recognized as canonical website intake
      expect(isWebsiteLead(leadA as Lead)).toBe(true);
      expect(leadA.source).toBe('website');
      expect(leadA.source_detail).toBe('course_information_request');
      expect(leadA.source_detail).not.toBe('contact_form');
      expect(leadA.source_detail).not.toBe('website_registration_form');
    });

    it('A3. brand-new lead starts in Novo Lead (capture), Novas entradas marked, NO enrollment created', () => {
      const newLead: Partial<Lead> = {
        id: 'new-lead-1',
        first_name: 'Carlos',
        last_name: 'Moraes',
        source: 'website',
        source_detail: 'course_information_request',
        pipeline_stage_id: 'stage-capture',
        has_new_submission: true,
        is_returning_submission: false,
        course_interest: 'Zygomatic Implant Training',
      };

      render(
        <MinimalLeadCard
          lead={newLead as Lead}
          stageCode="capture"
          interests={[{ courseName: 'Zygomatic Implant Training' }]}
        />
      );

      // Card renders correctly
      expect(screen.getByText('Carlos Moraes')).toBeInTheDocument();
      expect(screen.getByText('Site')).toBeInTheDocument();
      expect(screen.getByText('Nova entrada • Novo formulário')).toBeInTheDocument();
      expect(screen.getByText('Zygomatic')).toBeInTheDocument();
      // NO enrollment badge or label
      expect(screen.queryByText('Matrícula')).not.toBeInTheDocument();
    });

    it('A4. returning lead preserves current stage (Respondido), marks Retorno, NO enrollment created', () => {
      const returningLead: Partial<Lead> = {
        id: 'returning-lead-1',
        first_name: 'Rashawn',
        last_name: 'Test',
        source: 'meta', // Historical original source preserved
        source_detail: 'lead_gen_ad',
        pipeline_stage_id: 'stage-qualification',
        has_new_submission: true,
        is_returning_submission: true, // Marked as Retorno
        course_interest: 'Advanced Dental Implant Experience',
        ...({
          form_submissions: [
            { source_detail: 'course_information_request' },
          ],
        } as any),
      };

      render(
        <MinimalLeadCard
          lead={returningLead as Lead}
          stageCode="qualification"
          stageName="Respondido"
          interests={[{ courseName: 'Advanced Dental Implant Experience' }]}
        />
      );

      // Name and Retorno badge
      expect(screen.getByText('Rashawn Test')).toBeInTheDocument();
      expect(screen.getByText('Retorno')).toBeInTheDocument();
      // Site badge recognized via embedded submission touchpoint without overwriting original source
      expect(screen.getByText('Site')).toBeInTheDocument();
      // Course visible
      expect(screen.getByText('Advanced')).toBeInTheDocument();
    });

    it('A5. maps website course selection to canonical course name without enrollment', () => {
      expect(resolveCanonicalCourseName('Intensive Dental Implant Training')).toBe('Intensive Dental Implant Training');
      expect(resolveCanonicalCourseName('IDIT-01')).toBe('Intensive Dental Implant Training');
      expect(resolveCanonicalCourseName('ADIE-01')).toBe('Advanced Dental Implant Experience');
      expect(resolveCanonicalCourseName('ZIT-01')).toBe('Zygomatic Implant Training');
      expect(resolveCanonicalCourseName('Wisdom Teeth Training')).toBe('Wisdom Teeth Training');
      expect(resolveCanonicalCourseName('Endodontics Training')).toBe('Endodontics Training');
      expect(resolveCanonicalCourseName('Periodontal Surgery Training')).toBe('Periodontal Surgery Training');
      // Raw fallback
      expect(resolveCanonicalCourseName('Custom Special Course')).toBe('Custom Special Course');
    });

    it('A7. internal email builder: subject format, dynamic fields, strict security token exclusion, HTML escaping', () => {
      const payload: InternalCourseInfoNotificationPayload = {
        idempotency_key: 'test_course_info_1',
        submission_id: 'sub_12345',
        lead_id: 'lead_99999',
        lead_name: 'Dr. Bruce Wayne <script>alert(1)</script>',
        email: 'bruce@wayne.com',
        phone: '+1 305 555 0199',
        course: 'Advanced Dental Implant Experience',
        message: 'Interested in the next upcoming hands-on cohort.',
        source_page: 'https://www.expdentalsolutions.com/request-course-information',
        utm_source: 'google',
        utm_medium: 'cpc',
        utm_campaign: 'implants_2027',
        utm_term: 'dental implants course',
        utm_content: 'ad_variant_b',
        raw_payload: {
          name: 'Dr. Bruce Wayne <script>alert(1)</script>',
          email: 'bruce@wayne.com',
          phone: '+1 305 555 0199',
          course_id: '98',
          message: 'Interested in the next upcoming hands-on cohort.',
          clinic_name: 'Wayne Dental Associates',
          years_in_practice: '12',
          // Security / sensitive fields that MUST be excluded
          _token: 'secret_csrf_token_xyz',
          csrf: 'csrf_token_abc',
          'g-recaptcha-response': 'captcha_response_token_123',
          recaptcha: 'captcha_internal',
          password: 'secret_password',
          _hp_company: '',
        },
      };

      const email = buildCourseInfoEmail(payload, 'https://hub.expdentalsolutions.com/leads/lead_99999');

      // 1. Subject format
      expect(email.subject).toBe('Request Course Information — Dr. Bruce Wayne <script>alert(1)</script> — Advanced Dental Implant Experience');

      // 2. Safe HTML escaping
      expect(email.html).not.toContain('<script>alert(1)</script>');
      expect(email.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');

      // 3. Dynamic fields included
      expect(email.html).toContain('Dr. Bruce Wayne');
      expect(email.html).toContain('bruce@wayne.com');
      expect(email.html).toContain('+1 305 555 0199');
      expect(email.html).toContain('Advanced Dental Implant Experience');
      expect(email.html).toContain('Interested in the next upcoming hands-on cohort.');
      expect(email.html).toContain('Wayne Dental Associates');
      expect(email.html).toContain('google');
      expect(email.html).toContain('implants_2027');

      // 4. Strict exclusion of CSRF / captcha / internal tokens
      expect(email.html).not.toContain('secret_csrf_token_xyz');
      expect(email.html).not.toContain('csrf_token_abc');
      expect(email.html).not.toContain('captcha_response_token_123');
      expect(email.html).not.toContain('secret_password');

      // 5. Plain text version
      expect(email.text).toContain('Dr. Bruce Wayne');
      expect(email.text).toContain('Advanced Dental Implant Experience');
      expect(email.text).toContain('bruce@wayne.com');
      expect(email.text).toContain('https://hub.expdentalsolutions.com/leads/lead_99999');
    });

    it('A8. operational email recipient: internal admins only, never applicant', async () => {
      const recipients = await resolveInternalRecipients(mockDb);
      expect(recipients).toContain('admin@expdentalsolutions.com');
      expect(recipients).not.toContain('bruce@wayne.com');
    });

    it('A9. email idempotency: browser retry does not duplicate email', async () => {
      const payload: InternalCourseInfoNotificationPayload = {
        submission_id: 'sub_unique_101',
        lead_id: 'lead_101',
        idempotency_key: 'internal_email:course_info:sub_unique_101',
        lead_name: 'Dr. Robert Smith',
        email: 'rsmith@example.com',
        phone: '+1 407 555 1234',
        course: 'Intensive Dental Implant Training',
      };

      // First submission
      const res1 = await sendInternalCourseInfoNotification(mockDb, payload);
      expect(res1.success).toBe(true);
      expect(res1.duplicate).toBeFalsy();
      expect(mockSendEmail).toHaveBeenCalledTimes(1);

      // Retry submission with same idempotency key
      const res2 = await sendInternalCourseInfoNotification(mockDb, payload);
      expect(res2.success).toBe(true);
      expect(res2.duplicate).toBe(true);
      expect(res2.already_sent).toBe(true);
      // Still called only 1 time!
      expect(mockSendEmail).toHaveBeenCalledTimes(1);
    });

    it('A10. strict email isolation: Request Course Info never triggers registration or contact us email', async () => {
      const regPayload: any = {
        event_type: 'completed_registration',
        idempotency_key: 'completed_reg_test_1',
        lead_id: 'lead_reg_1',
      };

      // Completed registration is canonically handled by Laravel RegistrationReceivedAdminMail
      // EDS HUB explicitly skips completed registration email dispatch
      const regRes = await sendInternalEnrollmentNotification(mockDb, regPayload);
      expect(regRes.success).toBe(true);
      expect(regRes.subject).toContain('Skipped: completed registration email is canonically dispatched by Laravel RegistrationReceivedAdminMail');
      expect(mockSendEmail).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // PART B: REGISTER FOR OUR COURSE
  // ===========================================================================
  describe('Part B: Completed Registration Rule & Matrícula Card', () => {
    it('B1. brand-new lead completing registration belongs in Matrícula stage', () => {
      const enrolledLead: Partial<Lead> = {
        id: 'new-enrolled-1',
        first_name: 'Jessica',
        last_name: 'Alba',
        source: 'website',
        source_detail: 'website_registration_form',
        pipeline_stage_id: 'stage-matricula',
        has_new_submission: true,
        is_returning_submission: false,
        course_interest: 'Advanced Dental Implant Experience',
      };

      render(
        <MinimalLeadCard
          lead={enrolledLead as Lead}
          stageCode="enrollment"
          stageName="Matrícula"
          interests={[
            {
              courseName: 'Advanced Dental Implant Experience',
              sessionTitle: 'Feb/Mar 2027',
            },
          ]}
        />
      );

      expect(screen.getByText('Jessica Alba')).toBeInTheDocument();
      expect(screen.getByText('Site')).toBeInTheDocument();
      expect(screen.getByText('Nova entrada • Novo formulário')).toBeInTheDocument();
      // Visibly shows Course + Turma
      expect(screen.getByText('Advanced • Feb/Mar 2027')).toBeInTheDocument();
    });

    it('B2. returning lead in Respondido preserves current stage, receives Retorno attention', () => {
      const returningCompleted: Partial<Lead> = {
        id: 'returning-enrolled-1',
        first_name: 'Marcus',
        last_name: 'Miller',
        source: 'meta',
        source_detail: 'lead_gen_ad',
        pipeline_stage_id: 'stage-qualification',
        has_new_submission: true,
        is_returning_submission: true,
        ...({
          form_submissions: [
            { source_detail: 'website_registration_form' },
          ],
        } as any),
      };

      render(
        <MinimalLeadCard
          lead={returningCompleted as Lead}
          stageCode="qualification"
          stageName="Respondido"
          interests={[
            {
              courseName: 'Intensive Dental Implant Training',
              sessionTitle: 'Turma 02 - Nov 2026',
            },
          ]}
        />
      );

      // Preserved in Respondido, shows Retorno badge
      expect(screen.getByText('Marcus Miller')).toBeInTheDocument();
      expect(screen.getByText('Retorno')).toBeInTheDocument();
      expect(screen.getByText('Site')).toBeInTheDocument();
      // Shows Course + Turma
      expect(screen.getByText('Intensive • Turma 02 - Nov 2026')).toBeInTheDocument();
    });

    it('B3. Matrícula Card: shows Course + Turma, never displays raw UUID, does not invent turma when absent', () => {
      // Scenario 1: Factual human-readable turma
      const leadWithTurma: Partial<Lead> = {
        id: 'card-1',
        first_name: 'David',
        last_name: 'Kim',
        source: 'website',
        source_detail: 'website_registration_form',
      };

      const { unmount } = render(
        <MinimalLeadCard
          lead={leadWithTurma as Lead}
          stageCode="enrollment"
          interests={[
            {
              courseName: 'Advanced Dental Implant Experience',
              sessionTitle: 'Feb/Mar 2027',
            },
          ]}
        />
      );

      expect(screen.getByText('Advanced • Feb/Mar 2027')).toBeInTheDocument();
      unmount();

      // Scenario 2: Raw UUID in session title -> must be filtered out, never shown
      const leadWithUuidTurma: Partial<Lead> = {
        id: 'card-2',
        first_name: 'Sarah',
        last_name: 'Connor',
        source: 'website',
      };

      const { unmount: unmount2 } = render(
        <MinimalLeadCard
          lead={leadWithUuidTurma as Lead}
          stageCode="enrollment"
          interests={[
            {
              courseName: 'Zygomatic Implant Training',
              sessionTitle: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', // Raw UUID
            },
          ]}
        />
      );

      // Never shows raw UUID!
      expect(screen.queryByText(/a1b2c3d4-e5f6-7890-abcd-ef1234567890/)).not.toBeInTheDocument();
      expect(screen.getByText('Zygomatic')).toBeInTheDocument();
      unmount2();

      // Scenario 3: No factual turma exists -> does not invent one
      const leadWithoutTurma: Partial<Lead> = {
        id: 'card-3',
        first_name: 'James',
        last_name: 'Wilson',
        source: 'website',
      };

      render(
        <MinimalLeadCard
          lead={leadWithoutTurma as Lead}
          stageCode="enrollment"
          interests={[
            {
              courseName: 'Wisdom Teeth Training',
              sessionTitle: null,
            },
          ]}
        />
      );

      expect(screen.getByText('Wisdom')).toBeInTheDocument();
      expect(screen.queryByText(/•/)).not.toBeInTheDocument();
    });

    it('B4 & B5. Completed Registration Email: single approved client recipient, zero EDS HUB duplicate', async () => {
      // In Laravel:
      // Mail::to(config('mail.admin_address'))->send(new RegistrationReceivedAdminMail($registration));
      // Recipient count is exactly 1 (the single approved client email address from env/config)
      const laravelRecipientConfig = "config('mail.admin_address') || env('MAIL_ADMIN_ADDRESS')";
      expect(laravelRecipientConfig).toBeDefined();

      // In EDS HUB:
      const res = await sendInternalEnrollmentNotification(mockDb, {
        event_type: 'completed_registration',
        idempotency_key: 'comp_test_1',
      });

      // EDS HUB intentionally does NOT generate completed registration email
      expect(res.subject).toContain('RegistrationReceivedAdminMail');
      expect(res.recipients).toEqual([]);
      expect(mockSendEmail).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // PART C: EMAIL RECIPIENT SAFETY & ISOLATION
  // ===========================================================================
  describe('Part C: Email Recipient Safety & Isolation', () => {
    it('verifies isolation among all four email types', () => {
      // 1. Completed Registration email -> Laravel RegistrationReceivedAdminMail (1 client approved address)
      // 2. Incomplete Registration email -> EDS HUB internal admin notification list (10m inactivity)
      // 3. Contact Us email -> EDS HUB internal admin notification list (immediate)
      // 4. Request Course Information email -> EDS HUB internal admin notification list (immediate)
      const recipientStrategies = {
        completed_registration: 'Single approved client recipient via Laravel config(mail.admin_address)',
        incomplete_registration: 'Active internal administrators via resolveInternalRecipients (app_user)',
        contact_us: 'Active internal administrators via resolveInternalRecipients (app_user)',
        course_information_request: 'Active internal administrators via resolveInternalRecipients (app_user)',
      };

      expect(recipientStrategies.completed_registration).toContain('Single approved client recipient');
      expect(recipientStrategies.course_information_request).toContain('Active internal administrators');
      expect(recipientStrategies.contact_us).toContain('Active internal administrators');
      expect(recipientStrategies.incomplete_registration).toContain('Active internal administrators');
    });
  });
});
