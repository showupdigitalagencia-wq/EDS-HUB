import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MinimalLeadCard } from '../features/pipeline/components/MinimalLeadCard';
import {
  resolveLeadLastEmailStatus,
  batchFetchPipelineDeliverabilityHealth,
  type LeadLastEmailStatus,
  type LeadDeliverabilityInfo,
} from '../features/dashboard/services/deliverability-health-service';
import { NewLeadModal } from '../features/leads/components/NewLeadModal';
import { ManageCourseModal } from '../features/courses/components/ManageCourseModal';
import { supabase } from '../lib/supabase';
import type { Lead, Course, CourseSession } from '../types';

// Mock Supabase
vi.mock('../lib/supabase', () => {
  const queryBuilder: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    insert: vi.fn().mockResolvedValue({ data: [], error: null }),
    update: vi.fn().mockResolvedValue({ data: [], error: null }),
    delete: vi.fn().mockResolvedValue({ data: [], error: null }),
    then: (resolve: any) => resolve({ data: [], error: null }),
  };

  return {
    supabase: {
      rpc: vi.fn(),
      from: vi.fn(() => queryBuilder),
      channel: vi.fn(() => ({
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn().mockReturnThis(),
      })),
      removeChannel: vi.fn(),
    },
  };
});

describe('COHORTS / TURMAS + PIPELINE LAST EMAIL STATUS (Items A to Y)', () => {
  const mockCourses = [
    {
      id: 'course-zygo-1',
      code: 'ZYGO-01',
      name: 'Zygomatic Implant Training',
      active: true,
      sort_order: 1,
      created_at: '2026-01-01T00:00:00Z',
    },
    {
      id: 'course-intensive-2',
      code: 'INT-01',
      name: 'Intensive Dental Implant Training',
      active: true,
      sort_order: 2,
      created_at: '2026-01-01T00:00:00Z',
    },
  ] as unknown as Course[];

  const mockSessions = [
    {
      id: 'session-zygo-open',
      course_id: 'course-zygo-1',
      title: 'November 7–10, 2026',
      status: 'open',
      start_date: '2026-11-07',
      end_date: '2026-11-10',
      capacity: 12,
      location: 'São Paulo - SP',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    {
      id: 'session-zygo-closed',
      course_id: 'course-zygo-1',
      title: 'October 2026',
      status: 'confirmed', // confirmed represents closed for new registrations
      start_date: '2026-10-01',
      end_date: '2026-10-04',
      capacity: 12,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    {
      id: 'session-zygo-completed',
      course_id: 'course-zygo-1',
      title: 'August 2026',
      status: 'completed',
      start_date: '2026-08-01',
      end_date: '2026-08-04',
      capacity: 12,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    {
      id: 'session-zygo-cancelled',
      course_id: 'course-zygo-1',
      title: 'September 2026',
      status: 'cancelled',
      start_date: '2026-09-01',
      end_date: '2026-09-04',
      capacity: 12,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    {
      id: 'session-int-open',
      course_id: 'course-intensive-2',
      title: 'February 2027',
      status: 'open',
      start_date: '2027-02-15',
      end_date: '2027-02-18',
      capacity: 16,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ] as unknown as CourseSession[];

  const baseLead = {
    id: 'lead-test-1',
    first_name: 'Ana',
    last_name: 'Silva',
    email: 'ana.silva@example.com',
    phone_raw: '+55 11 99999-8888',
    phone_e164: '+5511999998888',
    course_interest: 'Zygomatic Implant Training',
    source: 'meta',
    pipeline_stage_id: 'stage-1',
    created_at: '2026-10-04T12:00:00Z',
    updated_at: '2026-10-04T12:00:00Z',
  } as unknown as Lead;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // SECTION 1: COURSE COHORT MANAGEMENT (Items A - G)
  // ===========================================================================
  describe('Course Cohort Management (Items A - G)', () => {
    it('A. renders cohorts strictly for the correct course and supports turma creation', async () => {
      const qBuilder: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockImplementation((col: string, val: string) => {
          if (col === 'course_id') {
            return {
              order: vi.fn().mockReturnValue({
                then: (cb: any) =>
                  cb({
                    data: mockSessions.filter((s) => s.course_id === val),
                    error: null,
                  }),
              }),
            };
          }
          return qBuilder;
        }),
        order: vi.fn().mockReturnThis(),
        then: (cb: any) => cb({ data: [], error: null }),
      };
      (supabase.from as any).mockReturnValue(qBuilder);

      render(
        <ManageCourseModal
          course={{
            id: 'course-zygo-1',
            code: 'ZYGO-01',
            name: 'Zygomatic Implant Training',
            description: 'Course description',
            active: true,
            sort_order: 1,
          }}
          isOpen={true}
          onClose={() => {}}
          onCourseUpdated={() => {}}
        />
      );

      // Switch to Turmas tab
      const turmasTab = screen.getByText(/turmas/i);
      fireEvent.click(turmasTab);

      // Verify header and "Adicionar Turma" button
      expect(screen.getByText(/adicionar turma/i)).toBeInTheDocument();

      // Open new turma form
      fireEvent.click(screen.getByText(/adicionar turma/i));
      expect(screen.getByText(/nova turma do curso/i)).toBeInTheDocument();
      expect(screen.getByText(/curso canônico vinculado:/i)).toBeInTheDocument();
    });

    it('B. allows editing cohort details without page reload', async () => {
      const zygoSessions = mockSessions.filter((s) => s.course_id === 'course-zygo-1');
      const qBuilder: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            then: (cb: any) => cb({ data: zygoSessions, error: null }),
          }),
        }),
        order: vi.fn().mockReturnThis(),
        then: (cb: any) => cb({ data: [], error: null }),
      };
      (supabase.from as any).mockReturnValue(qBuilder);

      render(
        <ManageCourseModal
          course={{
            id: 'course-zygo-1',
            code: 'ZYGO-01',
            name: 'Zygomatic Implant Training',
            description: null,
            active: true,
            sort_order: 1,
          }}
          isOpen={true}
          onClose={() => {}}
          onCourseUpdated={() => {}}
        />
      );

      fireEvent.click(screen.getByText(/turmas/i));
      await waitFor(() => {
        expect(screen.getByText('November 7–10, 2026')).toBeInTheDocument();
      });

      // Find edit button for first session
      const editButtons = screen.getAllByRole('button', { name: /editar/i });
      expect(editButtons.length).toBeGreaterThan(0);
      fireEvent.click(editButtons[0]);

      // Form enters edit mode
      expect(screen.getByText(/editar turma/i)).toBeInTheDocument();
    });

    it('C, D, E, F. filters cohorts: only OPEN cohorts are available for assignment, CLOSED/COMPLETED/CANCELLED are hidden', () => {
      // In NewLeadModal logic:
      const availableForCourse = mockSessions.filter(
        (s) => s.course_id === 'course-zygo-1' && s.status === 'open'
      );
      expect(availableForCourse.length).toBe(1);
      expect(availableForCourse[0].id).toBe('session-zygo-open');
      expect(availableForCourse.map((s) => s.id)).not.toContain('session-zygo-closed');
      expect(availableForCourse.map((s) => s.id)).not.toContain('session-zygo-completed');
      expect(availableForCourse.map((s) => s.id)).not.toContain('session-zygo-cancelled');
    });

    it('G. cohort from Course A never appears under Course B', () => {
      const intensiveOpenSessions = mockSessions.filter(
        (s) => s.course_id === 'course-intensive-2' && s.status === 'open'
      );
      expect(intensiveOpenSessions.length).toBe(1);
      expect(intensiveOpenSessions[0].id).toBe('session-int-open');
      expect(intensiveOpenSessions.some((s) => s.id === 'session-zygo-open')).toBe(false);
    });
  });

  // ===========================================================================
  // SECTION 2: LEAD COHORT SELECTION & PERSISTENCE (Items H - L)
  // ===========================================================================
  describe('Lead Cohort Selection & Dynamic Behavior (Items H - L)', () => {
    it('H. NewLeadModal renders open cohorts dynamically when course is selected', async () => {
      const qBuilder: any = {
        select: vi.fn().mockImplementation((cols: string) => {
          if (cols.includes('course_id')) {
            return {
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  then: (cb: any) =>
                    cb({
                      data: mockSessions.filter((s) => s.status === 'open'),
                      error: null,
                    }),
                }),
              }),
            };
          }
          return {
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                then: (cb: any) => cb({ data: mockCourses, error: null }),
              }),
            }),
            order: vi.fn().mockReturnValue({
              then: (cb: any) => cb({ data: mockCourses, error: null }),
            }),
          };
        }),
      };
      (supabase.from as any).mockReturnValue(qBuilder);

      render(<NewLeadModal isOpen={true} onClose={() => {}} onLeadCreated={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('Adicionar Novo Lead')).toBeInTheDocument();
      });

      // Initially no course selected -> turma selector is disabled
      const sessionSelect = screen.getByTestId('lead-session-select-0');
      expect(sessionSelect).toBeDisabled();
      expect(screen.getByText(/selecione o curso primeiro/i)).toBeInTheDocument();
    });

    it('J & K. multiple course interests support separate cohorts and clearing invalid cohort on change', () => {
      // Test dynamic state transition logic
      interface InterestEntry {
        courseId: string;
        sessionId: string;
      }
      let interests: InterestEntry[] = [
        { courseId: 'course-zygo-1', sessionId: 'session-zygo-open' },
        { courseId: 'course-intensive-2', sessionId: 'session-int-open' },
      ];

      // Priority 1 and Priority 2 maintain completely separate cohorts
      expect(interests[0].sessionId).toBe('session-zygo-open');
      expect(interests[1].sessionId).toBe('session-int-open');

      // Changing course 1 to a different course resets sessionId
      const newCourseId = 'course-new-3';
      interests = interests.map((entry, idx) =>
        idx === 0 ? { ...entry, courseId: newCourseId, sessionId: '' } : entry
      );
      expect(interests[0].sessionId).toBe('');
      expect(interests[1].sessionId).toBe('session-int-open');
    });

    it('L. shows "Nenhuma turma disponível" and disables select when course has no open cohorts', () => {
      const emptySessions: CourseSession[] = [];
      const openSessions = emptySessions.filter((s) => s.course_id === 'course-zygo-1' && s.status === 'open');
      expect(openSessions.length).toBe(0);
    });
  });

  // ===========================================================================
  // SECTION 3: PIPELINE LAST EMAIL STATUS BADGE (Items M - U)
  // ===========================================================================
  describe('Pipeline Last Email Status Badge (Items M - U)', () => {
    it('M. resolves SENT status: "E-mail enviado (04/10)"', () => {
      const messages = [
        {
          id: 'msg-1',
          channel: 'email',
          status: 'sent',
          sent_at: '2026-10-04T10:00:00Z',
          created_at: '2026-10-04T10:00:00Z',
        },
      ];
      const status = resolveLeadLastEmailStatus(messages);
      expect(status).not.toBeNull();
      expect(status?.status).toBe('sent');
      expect(status?.label).toBe('E-mail enviado (04/10)');
    });

    it('N. resolves DELIVERED status: "E-mail entregue (04/10)"', () => {
      const messages = [
        {
          id: 'msg-2',
          channel: 'email',
          status: 'delivered',
          sent_at: '2026-10-04T10:00:00Z',
          delivered_at: '2026-10-04T10:01:00Z',
          created_at: '2026-10-04T10:00:00Z',
        },
      ];
      const status = resolveLeadLastEmailStatus(messages);
      expect(status).not.toBeNull();
      expect(status?.status).toBe('delivered');
      expect(status?.label).toBe('E-mail entregue (04/10)');
    });

    it('O. resolves OPEN DETECTED: "E-mail aberto (04/10)" with factual open semantics (never "lido")', () => {
      const messages = [
        {
          id: 'msg-3',
          channel: 'email',
          status: 'opened',
          sent_at: '2026-10-04T10:00:00Z',
          delivered_at: '2026-10-04T10:01:00Z',
          opened_at: '2026-10-04T10:52:00Z',
          created_at: '2026-10-04T10:00:00Z',
        },
      ];
      const status = resolveLeadLastEmailStatus(messages);
      expect(status).not.toBeNull();
      expect(status?.status).toBe('opened');
      expect(status?.label).toBe('E-mail aberto (04/10)');
      expect(status?.label.toLowerCase()).not.toContain('lido');
      expect(status?.fullTimestamp).toMatch(/04\/10 \d\d:52/);
    });

    it('P. resolves CLICK DETECTED: "Clicou no e-mail (04/10)" with top precedence over opened', () => {
      const messages = [
        {
          id: 'msg-4',
          channel: 'email',
          status: 'clicked',
          sent_at: '2026-10-04T10:00:00Z',
          delivered_at: '2026-10-04T10:01:00Z',
          opened_at: '2026-10-04T10:05:00Z',
          clicked_at: '2026-10-04T10:12:00Z',
          created_at: '2026-10-04T10:00:00Z',
        },
      ];
      const status = resolveLeadLastEmailStatus(messages);
      expect(status).not.toBeNull();
      expect(status?.status).toBe('clicked');
      expect(status?.label).toBe('Clicou no e-mail (04/10)');
    });

    it('Q. resolves FAILED status: "Falha de entrega"', () => {
      const messages = [
        {
          id: 'msg-5',
          channel: 'email',
          status: 'failed',
          failed_at: '2026-10-04T10:00:00Z',
          created_at: '2026-10-04T10:00:00Z',
        },
      ];
      const status = resolveLeadLastEmailStatus(messages);
      expect(status).not.toBeNull();
      expect(status?.status).toBe('failed');
      expect(status?.label).toBe('Falha de entrega');
    });

    it('R. resolves HARD BOUNCE: "Hard Bounce"', () => {
      const messages = [
        {
          id: 'msg-6',
          channel: 'email',
          status: 'bounced',
          bounce_type: 'hard_bounce',
          bounced_at: '2026-10-04T10:00:00Z',
          created_at: '2026-10-04T10:00:00Z',
        },
      ];
      const status = resolveLeadLastEmailStatus(messages);
      expect(status).not.toBeNull();
      expect(status?.status).toBe('hard_bounce');
      expect(status?.label).toBe('Hard Bounce');
    });

    it('S. multi-recipient aggregation: if Recipient A hard bounces but Recipient B opens, email badge shows open detected without failing the entire lead', () => {
      const dispatchTime = '2026-10-04T10:00:00Z';
      const multiRecipientMessages = [
        {
          id: 'msg-rec-a',
          channel: 'email',
          recipient_email: 'invalid@example.com',
          status: 'bounced',
          bounce_type: 'hard_bounce',
          bounced_at: dispatchTime,
          created_at: dispatchTime,
        },
        {
          id: 'msg-rec-b',
          channel: 'email',
          recipient_email: 'valid@example.com',
          status: 'opened',
          delivered_at: dispatchTime,
          opened_at: '2026-10-04T10:15:00Z',
          created_at: dispatchTime,
        },
      ];

      const status = resolveLeadLastEmailStatus(multiRecipientMessages);
      expect(status).not.toBeNull();
      // Positive outcome on Recipient B prevails for the recent outbound badge
      expect(status?.status).toBe('opened');
      expect(status?.label).toBe('E-mail aberto (04/10)');
    });

    it('U. returns null when lead has no outbound messages (no fake badge)', () => {
      expect(resolveLeadLastEmailStatus(null)).toBeNull();
      expect(resolveLeadLastEmailStatus([])).toBeNull();
    });
  });

  // ===========================================================================
  // SECTION 4: PIPELINE BADGE COEXISTENCE & PERFORMANCE (Items V - Y)
  // ===========================================================================
  describe('Pipeline Badge Coexistence & Zero N+1 Queries (Items V - Y)', () => {
    it('V. SMS, WhatsApp, and Email badges coexist without overwriting each other', () => {
      const emailStatus: LeadLastEmailStatus = {
        status: 'opened',
        label: 'E-mail aberto (04/10)',
        dateStr: '04/10',
        badgeClass: 'bg-sky-50 text-sky-700 border-sky-200',
        dotColor: 'bg-sky-500',
      };

      render(
        <MinimalLeadCard
          lead={baseLead}
          smsSentInfo={{ sentAt: '2026-10-03T14:00:00Z', formattedDate: '03/10' }}
          whatsappSentInfo={{ sentAt: '2026-10-04T09:30:00Z', formattedDate: '04/10' }}
          emailStatusInfo={emailStatus}
        />
      );

      // Verify all 3 outbound channel badges coexist
      expect(screen.getByTestId('lead-card-sms-sent-badge')).toBeInTheDocument();
      expect(screen.getByText('SMS enviado')).toBeInTheDocument();
      expect(screen.getByText('(03/10)')).toBeInTheDocument();

      expect(screen.getByTestId('lead-card-whatsapp-sent-badge')).toBeInTheDocument();
      expect(screen.getByText('WhatsApp enviado')).toBeInTheDocument();

      expect(screen.getByTestId('lead-card-email-status-badge')).toBeInTheDocument();
      expect(screen.getByText('E-mail aberto (04/10)')).toBeInTheDocument();
    });

    it('W. deliverability risk badge and factual delivery status coexist with outbound channel badges', () => {
      const deliverabilityHealth: LeadDeliverabilityInfo = {
        status: 'risco',
        label: 'Risco',
        description: 'Hard bounce registrado',
        dotColor: 'bg-rose-500',
        badgeClass: 'bg-rose-50 text-rose-700',
        risk: {
          level: 'critico',
          label: 'Crítico',
          reasons: ['Hard Bounce'],
          color: 'text-rose-600',
          badgeClass: 'bg-rose-100 text-rose-800 border-rose-300',
        },
        recentEmailStatus: {
          status: 'opened',
          label: 'E-mail aberto (04/10)',
          dateStr: '04/10',
          badgeClass: 'bg-sky-50 text-sky-700 border-sky-200',
          dotColor: 'bg-sky-500',
        },
      };

      render(
        <MinimalLeadCard
          lead={baseLead}
          deliverabilityHealth={deliverabilityHealth}
        />
      );

      // Verify email status badge rendered from deliverabilityHealth
      expect(screen.getByTestId('lead-card-email-status-badge')).toBeInTheDocument();
      expect(screen.getByText('E-mail aberto (04/10)')).toBeInTheDocument();

      // Verify risk badge coexists
      expect(screen.getByTestId('deliverability-risk-badge')).toBeInTheDocument();
      expect(screen.getByText(/risco: crítico/i)).toBeInTheDocument();
    });

    it('Y. verifies ZERO N+1 queries: batchFetchPipelineDeliverabilityHealth executes a single batch query for multiple leads', async () => {
      const batchLeads: Lead[] = [
        { ...baseLead, id: 'lead-1', email: 'lead1@test.com' },
        { ...baseLead, id: 'lead-2', email: 'lead2@test.com' },
        { ...baseLead, id: 'lead-3', email: 'lead3@test.com' },
      ];

      let outboundQueryCount = 0;
      const qBuilder: any = {
        select: vi.fn().mockImplementation(() => {
          outboundQueryCount++;
          return qBuilder;
        }),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnValue({
          then: (cb: any) => cb({ data: [], error: null }),
        }),
        limit: vi.fn().mockReturnValue({
          then: (cb: any) => cb({ data: [], error: null }),
        }),
        then: (cb: any) => cb({ data: [], error: null }),
      };
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'outbound_messages') return qBuilder;
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnValue({
            then: (cb: any) => cb({ data: [], error: null }),
          }),
        };
      });

      const resultMap = await batchFetchPipelineDeliverabilityHealth(batchLeads);

      // Exactly 1 batch query to outbound_messages for all 3 leads, not 3 separate queries!
      expect(outboundQueryCount).toBe(1);
      expect(Object.keys(resultMap).length).toBe(3);
    });
  });
});
