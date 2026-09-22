import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LeadQuickActionBar } from '../features/leads/components/LeadQuickActionBar';
import { LeadTaskModal } from '../features/leads/components/LeadTaskModal';
import { LeadTaskList, formatTaskTypeLabel, formatTaskDateTime } from '../features/leads/components/LeadTaskList';
import { LeadTimeline, countContactAttempts, getActivityLabel } from '../features/leads/components/LeadTimeline';
import * as workQueueService from '../features/work/services/work-queue-service';
import { supabase } from '../lib/supabase';
import type { Lead, Task, LeadActivity } from '../types';

// Mock Supabase
vi.mock('../lib/supabase', () => {
  const insertMock = vi.fn().mockResolvedValue({ data: null, error: null });
  const selectMock = vi.fn().mockReturnThis();
  const eqMock = vi.fn().mockReturnThis();
  const orderMock = vi.fn().mockResolvedValue({ data: [], error: null });
  const singleMock = vi.fn().mockResolvedValue({ data: null, error: null });

  return {
    supabase: {
      from: vi.fn(() => ({
        insert: insertMock,
        select: selectMock,
        eq: eqMock,
        order: orderMock,
        single: singleMock,
      })),
      rpc: vi.fn().mockResolvedValue({ data: { success: true }, error: null }),
    },
  };
});

// Mock AuthProvider context for Sidebar and Layout inside LeadDetailPage
vi.mock('../features/auth/AuthProvider', () => ({
  useAuth: () => ({
    session: { user: { id: 'test-user-id' } },
    user: { id: 'test-user-id' },
    appUser: {
      id: 'app-user-1',
      display_name: 'Dr. Test Coordinator',
      email: 'coordinator@example.com',
      is_active: true,
      role: 'admin',
    },
    isLoading: false,
    isAuthorized: true,
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
}));

// Mock Work Queue Service
vi.mock('../features/work/services/work-queue-service', async (importOriginal) => {
  const actual = await importOriginal<typeof workQueueService>();
  return {
    ...actual,
    createCrmTask: vi.fn().mockResolvedValue({ success: true, task_id: 'task-123' }),
    completeCrmTask: vi.fn().mockResolvedValue({ success: true, task_id: 'task-123' }),
  };
});

const mockLead: Lead = {
  id: 'lead-test-401',
  first_name: 'Arthur',
  last_name: 'Dentist',
  email: 'arthur@dentist.com',
  phone_raw: '+1 (941) 830-1451',
  phone_e164: '+19418301451',
  contact_preference: 'email',
  pipeline_stage_id: 'stage-1',
  source: 'manual',
  source_detail: null,
  external_lead_id: null,
  qualification_status: 'hot',
  email_confirmation: null,
  course_interest: 'Zygomatic',
  course_interests: ['Zygomatic'],
  referred_by: 'Dr. Roberto',
  source_created_at: null,
  created_at: '2026-09-01T10:00:00Z',
  updated_at: '2026-09-01T10:00:00Z',
  hubspot_contact_id: 'hs-9988',
};

describe('EDS HUB — Batch 4: Lead Detail & Operational Workspace Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /* -------------------------------------------------------------------------- */
  /* 1. Quick Action Bar Tests                                                 */
  /* -------------------------------------------------------------------------- */
  describe('Quick Action Bar (LeadQuickActionBar)', () => {
    it('renders all 6 buttons: Ligar, SMS, Email, WhatsApp, Adicionar Tarefa, Pagamento', () => {
      render(
        <LeadQuickActionBar
          lead={mockLead}
          onOpenTaskModal={vi.fn()}
          onOpenPaymentModal={vi.fn()}
        />
      );

      expect(screen.getByRole('button', { name: /ligar/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /sms/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /email/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /whatsapp/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /adicionar tarefa/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /pagamento/i })).toBeDefined();
    });

    it('enables call, sms, email, and whatsapp when lead has valid phone and email', () => {
      render(
        <LeadQuickActionBar
          lead={mockLead}
          onOpenTaskModal={vi.fn()}
          onOpenPaymentModal={vi.fn()}
        />
      );

      expect(screen.getByRole('button', { name: /ligar/i })).not.toBeDisabled();
      expect(screen.getByRole('button', { name: /sms/i })).not.toBeDisabled();
      expect(screen.getByRole('button', { name: /email/i })).not.toBeDisabled();
      expect(screen.getByRole('button', { name: /whatsapp/i })).not.toBeDisabled();
    });

    it('disables call, sms, and whatsapp when lead has missing phone', () => {
      const leadNoPhone: Lead = {
        ...mockLead,
        phone_raw: null,
        phone_e164: null,
      };

      render(
        <LeadQuickActionBar
          lead={leadNoPhone}
          onOpenTaskModal={vi.fn()}
          onOpenPaymentModal={vi.fn()}
        />
      );

      expect(screen.getByRole('button', { name: /ligar/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /sms/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /whatsapp/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /email/i })).not.toBeDisabled();
    });

    it('disables email button when lead has missing email', () => {
      const leadNoEmail: Lead = {
        ...mockLead,
        email: null,
      };

      render(
        <LeadQuickActionBar
          lead={leadNoEmail}
          onOpenTaskModal={vi.fn()}
          onOpenPaymentModal={vi.fn()}
        />
      );

      expect(screen.getByRole('button', { name: /email/i })).toBeDisabled();
    });

    it('opens task modal when "Adicionar Tarefa" is clicked', () => {
      const onOpenTaskModal = vi.fn();
      render(
        <LeadQuickActionBar
          lead={mockLead}
          onOpenTaskModal={onOpenTaskModal}
          onOpenPaymentModal={vi.fn()}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /adicionar tarefa/i }));
      expect(onOpenTaskModal).toHaveBeenCalledTimes(1);
    });

    it('opens payment modal when "Pagamento" is clicked', () => {
      const onOpenPaymentModal = vi.fn();
      render(
        <LeadQuickActionBar
          lead={mockLead}
          onOpenTaskModal={vi.fn()}
          onOpenPaymentModal={onOpenPaymentModal}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /pagamento/i }));
      expect(onOpenPaymentModal).toHaveBeenCalledTimes(1);
    });

    it('clicking manual contact action logs intent to lead_activities without auto-advancing stage', async () => {
      const mockInsert = vi.fn().mockResolvedValue({ data: null, error: null });
      vi.mocked(supabase.from).mockReturnValue({
        insert: mockInsert,
      } as any);

      render(
        <LeadQuickActionBar
          lead={mockLead}
          onOpenTaskModal={vi.fn()}
          onOpenPaymentModal={vi.fn()}
        />
      );

      // Click WhatsApp
      const waButton = screen.getByRole('button', { name: /whatsapp/i });
      fireEvent.click(waButton);

      expect(supabase.from).toHaveBeenCalledWith('lead_activities');
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          lead_id: mockLead.id,
          activity_type: 'whatsapp_contact_attempt',
          actor_type: 'user',
          summary: 'WhatsApp aberto',
        })
      );
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 2. Simplified Lead Task Modal (LeadTaskModal)                             */
  /* -------------------------------------------------------------------------- */
  describe('Simplified Task & Payment Modal (LeadTaskModal)', () => {
    it('renders in Payment mode preconfigured with task_type = payment and title "Agendar lembrete de pagamento"', () => {
      render(
        <LeadTaskModal
          isOpen={true}
          onClose={vi.fn()}
          onTaskCreated={vi.fn()}
          leadId={mockLead.id}
          leadName="Dr. Arthur"
          mode="payment"
        />
      );

      expect(screen.getByText('Agendar lembrete de pagamento')).toBeDefined();
      expect(screen.getByText(/Pagamento \(Lembrete\)/i)).toBeDefined();
      expect(screen.getByRole('button', { name: /criar tarefa/i })).toBeDefined();

      // Ensure NO finance / revenue fields exist
      expect(screen.queryByLabelText(/valor/i)).toBeNull();
      expect(screen.queryByLabelText(/fatura/i)).toBeNull();
      expect(screen.queryByLabelText(/prioridade/i)).toBeNull();
    });

    it('submits payment reminder task calling createCrmTask with taskType "payment" and title "Pagamento"', async () => {
      const onTaskCreated = vi.fn();
      const onClose = vi.fn();

      render(
        <LeadTaskModal
          isOpen={true}
          onClose={onClose}
          onTaskCreated={onTaskCreated}
          leadId={mockLead.id}
          leadName="Dr. Arthur"
          mode="payment"
        />
      );

      const submitButton = screen.getByRole('button', { name: /criar tarefa/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(workQueueService.createCrmTask).toHaveBeenCalledWith(
          expect.objectContaining({
            leadId: mockLead.id,
            title: 'Pagamento',
            taskType: 'payment',
            priority: 'normal',
          })
        );
        expect(onTaskCreated).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
      });
    });

    it('renders in Generic Task mode allowing type selection between Ligar, Follow-up, and Pagamento', async () => {
      render(
        <LeadTaskModal
          isOpen={true}
          onClose={vi.fn()}
          onTaskCreated={vi.fn()}
          leadId={mockLead.id}
          leadName="Dr. Arthur"
          mode="generic"
        />
      );

      expect(screen.getByText('Adicionar Tarefa')).toBeDefined();
      const selectType = screen.getByRole('combobox') as HTMLSelectElement;
      expect(selectType).toBeDefined();

      // Change type to 'call'
      fireEvent.change(selectType, { target: { value: 'call' } });
      expect(selectType.value).toBe('call');

      const submitButton = screen.getByRole('button', { name: /criar tarefa/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(workQueueService.createCrmTask).toHaveBeenCalledWith(
          expect.objectContaining({
            leadId: mockLead.id,
            title: 'Ligar',
            taskType: 'call',
          })
        );
      });
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 3. Task List & Task Completion (LeadTaskList)                             */
  /* -------------------------------------------------------------------------- */
  describe('Task List & Task Completion (LeadTaskList)', () => {
    const mockTasks: Task[] = [
      {
        id: 'task-1',
        lead_id: mockLead.id,
        intake_event_id: null,
        created_by: 'user',
        title: 'Ligar para confirmar presença',
        task_type: 'call',
        task_source: 'manual',
        priority: 'normal',
        status: 'pending',
        due_at: '2026-10-25T14:00:00Z',
        created_at: '2026-09-01T10:00:00Z',
        updated_at: '2026-09-01T10:00:00Z',
        completed_at: null,
        description: 'Verificar se recebeu o cronograma',
      },
      {
        id: 'task-2',
        lead_id: mockLead.id,
        intake_event_id: null,
        created_by: 'user',
        title: 'Pagamento',
        task_type: 'payment',
        task_source: 'manual',
        priority: 'normal',
        status: 'pending',
        due_at: '2026-09-01T10:00:00Z', // Past date -> overdue
        created_at: '2026-09-01T09:00:00Z',
        updated_at: '2026-09-01T09:00:00Z',
        completed_at: null,
        description: 'Lembrete de pagamento da entrada',
      },
      {
        id: 'task-3',
        lead_id: mockLead.id,
        intake_event_id: null,
        created_by: 'user',
        title: 'Follow-up inicial',
        task_type: 'follow_up',
        task_source: 'manual',
        priority: 'normal',
        status: 'completed',
        due_at: '2026-08-30T10:00:00Z',
        created_at: '2026-08-28T10:00:00Z',
        updated_at: '2026-08-30T11:00:00Z',
        completed_at: '2026-08-30T11:00:00Z',
        description: null,
      },
    ];

    it('formats task type labels correctly in Portuguese', () => {
      expect(formatTaskTypeLabel('call')).toBe('Ligar');
      expect(formatTaskTypeLabel('follow_up')).toBe('Follow-up');
      expect(formatTaskTypeLabel('payment')).toBe('Pagamento');
      expect(formatTaskTypeLabel('data_review')).toBe('Revisão de Dados');
      expect(formatTaskTypeLabel('general')).toBe('Geral');
    });

    it('formats date and time in human-friendly format', () => {
      const formatted = formatTaskDateTime('2026-10-25T14:30:00Z');
      expect(formatted).toMatch(/25 Out/);
    });

    it('renders pending tasks first with nearest due and overdue indicator', () => {
      render(
        <LeadTaskList
          tasks={mockTasks}
          onOpenCreateTask={vi.fn()}
          onTaskUpdated={vi.fn()}
        />
      );

      // Overdue indicator
      expect(screen.getByText('Atrasada')).toBeDefined();
      expect(screen.getByText('Lembrete de pagamento da entrada')).toBeDefined();

      // Pending tasks count
      expect(screen.getByText(/Pendentes \(2\)/i)).toBeDefined();

      // Completed task rendered with Concluída badge
      expect(screen.getByText(/Concluídas \(1\)/i)).toBeDefined();
      expect(screen.getByText('Follow-up inicial')).toBeDefined();
      expect(screen.getByText('Concluída')).toBeDefined();
    });

    it('allows completing pending task via completeCrmTask and remains visible', async () => {
      const onTaskUpdated = vi.fn();
      render(
        <LeadTaskList
          tasks={mockTasks}
          onOpenCreateTask={vi.fn()}
          onTaskUpdated={onTaskUpdated}
        />
      );

      const completeButtons = screen.getAllByRole('button', { name: /marcar como concluída/i });
      expect(completeButtons.length).toBe(2);

      fireEvent.click(completeButtons[0]);

      await waitFor(() => {
        expect(workQueueService.completeCrmTask).toHaveBeenCalledWith('task-2');
        expect(onTaskUpdated).toHaveBeenCalledTimes(1);
      });
    });

    it('displays clean empty state when no tasks are present', () => {
      render(
        <LeadTaskList
          tasks={[]}
          onOpenCreateTask={vi.fn()}
          onTaskUpdated={vi.fn()}
        />
      );

      expect(screen.getByText('Nenhuma tarefa agendada')).toBeDefined();
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 4. Timeline & Canonical Contact Attempts Counter (LeadTimeline)           */
  /* -------------------------------------------------------------------------- */
  describe('Timeline & Contact Attempts Counter (LeadTimeline)', () => {
    const mockActivities: LeadActivity[] = [
      {
        id: 'act-1',
        lead_id: mockLead.id,
        intake_event_id: null,
        activity_type: 'email_dispatched',
        channel: 'email',
        actor_type: 'system',
        summary: 'Email de primeiro contato enviado',
        metadata: { outbound_message_id: 'msg-out-001' },
        created_at: '2026-09-01T10:05:00Z',
      },
      // Retry dispatch of same message — must NOT increment counter
      {
        id: 'act-2',
        lead_id: mockLead.id,
        intake_event_id: null,
        activity_type: 'email_dispatched',
        channel: 'email',
        actor_type: 'system',
        summary: 'Tentativa de reenvio de email',
        metadata: { outbound_message_id: 'msg-out-001' },
        created_at: '2026-09-01T10:10:00Z',
      },
      {
        id: 'act-3',
        lead_id: mockLead.id,
        intake_event_id: null,
        activity_type: 'sms_dispatched',
        channel: 'sms',
        actor_type: 'system',
        summary: 'SMS de primeiro contato enviado',
        metadata: { outbound_message_id: 'msg-out-002' },
        created_at: '2026-09-01T10:05:30Z',
      },
      {
        id: 'act-4',
        lead_id: mockLead.id,
        intake_event_id: null,
        activity_type: 'call_manual_attempt',
        channel: 'call',
        actor_type: 'user',
        summary: 'Ligação iniciada',
        metadata: { manual: true },
        created_at: '2026-09-02T15:00:00Z',
      },
      {
        id: 'act-5',
        lead_id: mockLead.id,
        intake_event_id: null,
        activity_type: 'whatsapp_contact_attempt',
        channel: null,
        actor_type: 'user',
        summary: 'WhatsApp aberto',
        metadata: { manual: true },
        created_at: '2026-09-03T11:00:00Z',
      },
      // Manual mailto / sms deep-links: MUST NOT increment contact attempt counter (Correction 1)
      {
        id: 'act-6',
        lead_id: mockLead.id,
        intake_event_id: null,
        activity_type: 'email_manual_attempt',
        channel: 'email',
        actor_type: 'user',
        summary: 'Email aberto para contato',
        metadata: { manual: true },
        created_at: '2026-09-04T09:00:00Z',
      },
      {
        id: 'act-7',
        lead_id: mockLead.id,
        intake_event_id: null,
        activity_type: 'sms_manual_attempt',
        channel: 'sms',
        actor_type: 'user',
        summary: 'SMS aberto para contato',
        metadata: { manual: true },
        created_at: '2026-09-04T09:05:00Z',
      },
      // Non-contact events (stage change, task, note, hubspot)
      {
        id: 'act-8',
        lead_id: mockLead.id,
        intake_event_id: null,
        activity_type: 'stage_changed',
        channel: null,
        actor_type: 'user',
        summary: 'Lead movido para Interessado',
        metadata: {},
        created_at: '2026-09-02T16:00:00Z',
      },
      {
        id: 'act-9',
        lead_id: mockLead.id,
        intake_event_id: null,
        activity_type: 'task_created',
        channel: null,
        actor_type: 'user',
        summary: 'Tarefa criada',
        metadata: {},
        created_at: '2026-09-02T16:10:00Z',
      },
      {
        id: 'act-10',
        lead_id: mockLead.id,
        intake_event_id: null,
        activity_type: 'hubspot_outbound_synced',
        channel: null,
        actor_type: 'system',
        summary: 'Sincronizado com HubSpot',
        metadata: {},
        created_at: '2026-09-02T16:15:00Z',
      },
    ];

    it('counts ONLY email_dispatched, sms_dispatched, call_manual_attempt, and whatsapp_contact_attempt', () => {
      // 1 email (deduped from 2) + 1 sms + 1 call + 1 whatsapp = exactly 4 attempts
      const count = countContactAttempts(mockActivities);
      expect(count).toBe(4);
    });

    it('does NOT count email_manual_attempt or sms_manual_attempt in counter', () => {
      const manualOnly: LeadActivity[] = [
        {
          id: 'm1',
          lead_id: 'l1',
          intake_event_id: null,
          activity_type: 'email_manual_attempt',
          channel: 'email',
          actor_type: 'user',
          summary: 'Email aberto para contato',
          metadata: {},
          created_at: '2026-09-01T10:00:00Z',
        },
        {
          id: 'm2',
          lead_id: 'l1',
          intake_event_id: null,
          activity_type: 'sms_manual_attempt',
          channel: 'sms',
          actor_type: 'user',
          summary: 'SMS aberto para contato',
          metadata: {},
          created_at: '2026-09-01T10:00:00Z',
        },
      ];

      expect(countContactAttempts(manualOnly)).toBe(0);
    });

    it('uses provider-honest Portuguese labels without implying delivered/opened', () => {
      expect(getActivityLabel('email_dispatched')).toBe('Envio de email iniciado');
      expect(getActivityLabel('sms_dispatched')).toBe('Envio de SMS iniciado');
      expect(getActivityLabel('call_manual_attempt')).toBe('Ligação iniciada');
      expect(getActivityLabel('whatsapp_contact_attempt')).toBe('WhatsApp aberto');
      expect(getActivityLabel('email_manual_attempt')).toBe('Email aberto para contato');
      expect(getActivityLabel('sms_manual_attempt')).toBe('SMS aberto para contato');
      expect(getActivityLabel('stage_changed')).toBe('Estágio alterado');
      expect(getActivityLabel('task_created')).toBe('Tarefa criada');
      expect(getActivityLabel('task_completed')).toBe('Tarefa concluída');
      expect(getActivityLabel('hubspot_contact_linked')).toBe('Vinculado ao HubSpot');
    });

    it('renders timeline header with exact contact attempt count badge', () => {
      render(<LeadTimeline activities={mockActivities} />);

      expect(screen.getByText('Tentativas de contato:')).toBeDefined();
      expect(screen.getByText('4')).toBeDefined();
      expect(screen.getByText('Linha do Tempo (10)')).toBeDefined();
      expect(screen.getAllByText('Envio de email iniciado').length).toBe(2);
      expect(screen.getAllByText('WhatsApp aberto').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Email aberto para contato').length).toBeGreaterThanOrEqual(1);
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 5. LeadDetailPage Integration & Responsiveness (390x844)                  */
  /* -------------------------------------------------------------------------- */
  describe('LeadDetailPage Full Page Integration & Mobile Viewport', () => {
    it('renders operational workspace with clean hierarchy without raw score in header', async () => {
      // Mock sub-table responses for full page load
      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'leads') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: mockLead, error: null }),
          } as any;
        }
        if (table === 'pipeline_stages') {
          return {
            select: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [{ id: 'stage-1', name: 'Novo Lead', code: 'capture', sort_order: 1 }],
              error: null,
            }),
          } as any;
        }
        if (table === 'lead_course_interests') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [
                {
                  priority: 1,
                  course: { name: 'Zygomatic' },
                  session: { title: 'Turma Novembro', start_date: '2026-11-15' },
                },
              ],
              error: null,
            }),
          } as any;
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as any;
      });

      const { LeadDetailPage } = await import('../features/leads/LeadDetailPage');
      const { MemoryRouter, Routes, Route } = await import('react-router-dom');

      render(
        <MemoryRouter initialEntries={['/leads/lead-test-401']}>
          <Routes>
            <Route path="/leads/:id" element={<LeadDetailPage />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        // Lead Name is prominent
        expect(screen.getByText('Arthur Dentist')).toBeDefined();
        // Stage is displayed
        expect(screen.getByText('Novo Lead')).toBeDefined();
        // Course interest formatted with Month Year
        expect(screen.getByText(/Zygomatic • Nov 2026/)).toBeDefined();
        // Quem indicou is shown
        expect(screen.getByText(/Dr\. Roberto/)).toBeDefined();
        // Quick Action buttons exist
        expect(screen.getByRole('button', { name: /ligar/i })).toBeDefined();
        expect(screen.getByRole('button', { name: /sms/i })).toBeDefined();
        expect(screen.getByRole('button', { name: /email/i })).toBeDefined();
        expect(screen.getByRole('button', { name: /whatsapp/i })).toBeDefined();
        // Section headers exist
        expect(screen.getByText(/Tarefas/)).toBeDefined();
        expect(screen.getByText(/Linha do Tempo/)).toBeDefined();
        expect(screen.getByText(/Notas Internas/)).toBeDefined();
      });
    });

    it('validates mobile viewport rendering at 390x844 without errors', async () => {
      // Set iPhone 12/13/14 viewport
      window.innerWidth = 390;
      window.innerHeight = 844;
      window.dispatchEvent(new Event('resize'));

      const { LeadDetailPage } = await import('../features/leads/LeadDetailPage');
      const { MemoryRouter, Routes, Route } = await import('react-router-dom');

      render(
        <MemoryRouter initialEntries={['/leads/lead-test-401']}>
          <Routes>
            <Route path="/leads/:id" element={<LeadDetailPage />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Arthur Dentist')).toBeDefined();
        expect(screen.getByRole('button', { name: /pagamento/i })).toBeDefined();
      });
    });
  });
});

