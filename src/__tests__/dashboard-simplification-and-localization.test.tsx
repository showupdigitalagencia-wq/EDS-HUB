import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from '../components/Sidebar';
import { MobileMenuSheet } from '../components/MobileMenuSheet';
import { SalesDashboardPage } from '../features/dashboard/SalesDashboardPage';
import { EmailHealthCard } from '../features/dashboard/components/EmailHealthCard';
import { IncompleteEnrollmentsWidget } from '../features/dashboard/components/IncompleteEnrollmentsWidget';
import { KpiCardsSection } from '../features/dashboard/components/KpiCardsSection';
import { LeadTaskModal } from '../features/leads/components/LeadTaskModal';
import { LeadQuickActionBar } from '../features/leads/components/LeadQuickActionBar';
import {
  classifyDeliverabilityHealth,
  calculateDeliverabilityRates,
  resolveLeadDeliverabilityHealth,
  type DeliverabilityHealthSummary,
} from '../features/dashboard/services/deliverability-health-service';
import type { SalesDashboardMetrics } from '../types/database';

// Mock navigation
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock AuthProvider context
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

// Mock work-queue-service
vi.mock('../features/work/services/work-queue-service', () => ({
  createCrmTask: vi.fn().mockResolvedValue({ id: 'task-123', status: 'pending' }),
  completeCrmTask: vi.fn().mockResolvedValue({ success: true, task_id: 'task-123' }),
  fetchDailyOperationsDashboard: vi.fn().mockResolvedValue({
    total_open_tasks: 5,
    due_today_count: 2,
    overdue_count: 0,
    needs_reply_count: 1,
    hot_leads_count: 3,
    pending_enrollment_tasks_count: 1,
    recent_completed_today_count: 4,
  }),
  fetchDailyOperationsQueue: vi.fn().mockResolvedValue({ items: [], total_count: 0 }),
}));

// Mock dashboard-service
const mockMetrics: SalesDashboardMetrics = {
  snapshot: {
    total_leads: 125,
    open_tasks: 5,
    open_conversations: 12,
    unread_conversations: 2,
  },
  pipeline: {
    funnel: [
      { sort_order: 1, stage_code: 'capture', stage_name: 'Novo Lead', unique_leads_entered: 40, conversion_from_prev: null },
      { sort_order: 2, stage_code: 'qualification', stage_name: 'Respondido', unique_leads_entered: 28, conversion_from_prev: 70 },
      { sort_order: 3, stage_code: 'acquisition', stage_name: 'Interessado', unique_leads_entered: 18, conversion_from_prev: 64.3 },
      { sort_order: 4, stage_code: 'approval', stage_name: 'Quente', unique_leads_entered: 10, conversion_from_prev: 55.6 },
      { sort_order: 5, stage_code: 'enrollment', stage_name: 'Matrícula', unique_leads_entered: 6, conversion_from_prev: 60 },
    ],
    current_distribution: [
      { stage_id: 's1', sort_order: 1, stage_name: 'Novo Lead', stage_code: 'capture', lead_count: 40, percentage: 32 },
      { stage_id: 's2', sort_order: 2, stage_name: 'Respondido', stage_code: 'qualification', lead_count: 28, percentage: 22.4 },
      { stage_id: 's3', sort_order: 3, stage_name: 'Interessado', stage_code: 'acquisition', lead_count: 18, percentage: 14.4 },
      { stage_id: 's4', sort_order: 4, stage_name: 'Quente', stage_code: 'approval', lead_count: 10, percentage: 8 },
      { stage_id: 's5', sort_order: 5, stage_name: 'Matrícula', stage_code: 'enrollment', lead_count: 6, percentage: 4.8 },
    ],
    movements_in_period: 45,
  },
  qualification: {
    confirmed_count: 15,
    distribution: [
      { status: 'uncontacted', label: 'Não Contatado', sort_order: 1, lead_count: 40, percentage: 32 },
      { status: 'contacted', label: 'Contatado', sort_order: 2, lead_count: 35, percentage: 28 },
      { status: 'qualified', label: 'Qualificado', sort_order: 3, lead_count: 25, percentage: 20 },
      { status: 'unqualified', label: 'Desqualificado', sort_order: 4, lead_count: 10, percentage: 8 },
    ],
  },
  scoring: {
    average_score: 45.2,
    hot_and_very_hot_count: 14,
    thresholds: {
      id: 'settings-1',
      cold_min: 0,
      cold_max: 29,
      warm_min: 30,
      warm_max: 59,
      hot_min: 60,
      hot_max: 84,
      very_hot_min: 85,
      very_hot_max: 100,
      updated_at: '2026-01-01T00:00:00Z',
    },
    distribution: [],
  },
  activity: {
    new_leads_count: 35,
    outbound_sent_count: 20,
    outbound_unique_leads: 18,
    inbound_replies_count: 18,
    inbound_unique_leads: 15,
    reply_rate: 51.4,
    avg_first_response_time_seconds: 120,
    trend: [],
  },
  automation: {
    active_workflows: 2,
    active_sequences: 1,
    period_runs_total: 10,
    period_runs_completed: 10,
    period_runs_failed: 0,
    sequences_performance: [],
  },
  tasks: {
    pending_tasks: 8,
    due_today: 3,
    overdue: 1,
    completed_all_time: 42,
  },
  demographics: {
    course_interest: [],
    sources: [],
    contact_preference: [],
  },
  priority_leads: [],
  needs_attention: [
    {
      lead_id: 'lead-att-1',
      lead_name: 'Dra. Marina Santos',
      lead_email: 'marina@dentist.com',
      reason_code: 'OVERDUE_TASK',
      reason_label: 'Tarefa Atrasada',
      detected_at: new Date().toISOString(),
      detail: 'Cobrança de formulário de inscrição',
    },
  ],
  period: {
    start_date: new Date(Date.now() - 30 * 86400000).toISOString(),
    end_date: new Date().toISOString(),
  },
  generated_at: new Date().toISOString(),
};

vi.mock('../features/dashboard/services/dashboard-service', () => ({
  fetchSalesDashboardMetrics: vi.fn().mockImplementation(() => Promise.resolve(mockMetrics)),
  getDateRangeBoundaries: vi.fn().mockReturnValue({
    startDate: '2026-01-01T00:00:00.000Z',
    endDate: '2026-01-31T23:59:59.999Z',
    label: 'Últimos 30 dias',
  }),
  formatRate: (val: number | null) => (val !== null ? `${val}%` : 'No data'),
  formatFirstResponseTime: (sec: number | null) => (sec ? `${sec}s` : 'No data'),
}));

// Mock deliverability-health-service
const mockDeliverabilityHealth: DeliverabilityHealthSummary = {
  level: 'Saudável',
  levelExplanation: 'Indicadores de entrega e rejeição dentro dos padrões recomendados.',
  isSufficientData: true,
  sampleCount: 120,
  minSampleRequired: 50,
  windowDays: 30,
  metrics: {
    sent: 120,
    delivered: 118,
    bounced: 1,
    complaints: 0,
    failed: 1,
    suppressed: 2,
  },
  rates: {
    deliveryRate: 98.3,
    bounceRate: 0.8,
    complaintRate: 0.0,
    failureRate: 0.8,
  },
  alerts: [],
  lastUpdated: new Date().toISOString(),
};

vi.mock('../features/dashboard/services/deliverability-health-service', async () => {
  const actual = await vi.importActual('../features/dashboard/services/deliverability-health-service');
  return {
    ...actual,
    fetchDeliverabilityHealth: vi.fn().mockImplementation(() => Promise.resolve(mockDeliverabilityHealth)),
  };
});

// Mock incomplete-enrollment-service
vi.mock('../features/leads/services/incomplete-enrollment-service', () => ({
  fetchPendingIncompleteEnrollments: vi.fn().mockResolvedValue([
    {
      id: 'inc-1',
      lead_id: 'lead-10',
      course_id: 'course-1',
      created_at: new Date().toISOString(),
      lead: { id: 'lead-10', first_name: 'Carlos', last_name: 'Mendes', email: 'carlos@example.com' },
      course: { id: 'course-1', name: 'Cirurgia Avançada', code: 'CIR-01' },
      course_session: { id: 'sess-1', title: 'Turma Março 2026', start_date: '2026-03-15' },
    },
  ]),
  fetchActiveIncompleteEnrollment: vi.fn().mockResolvedValue(null),
  dismissIncompleteEnrollment: vi.fn().mockResolvedValue({ success: true }),
}));

describe('EDS HUB — Dashboard Simplification + Portuguese UI + Deliverability Protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // 1. NAVIGATION TESTS
  // ===========================================================================
  describe('1. Navigation Streamlining & Visibility', () => {
    it('renders the 7 canonical operational items in primary Sidebar navigation', () => {
      render(
        <MemoryRouter>
          <Sidebar />
        </MemoryRouter>
      );

      // Core operational items must be visible
      expect(screen.getByText('Dashboard')).toBeDefined();
      expect(screen.getByText('Contatos')).toBeDefined();
      expect(screen.getByText('Pipeline')).toBeDefined();
      expect(screen.getByText('Tarefas')).toBeDefined();
      expect(screen.getByText('Conversas')).toBeDefined();
      expect(screen.getByText('Templates')).toBeDefined();
      expect(screen.getByText('Configurações')).toBeDefined();
    });

    it('strictly hides Foundation Status, Revenue, Financial Ledger, and Lead Scoring from primary navigation', () => {
      render(
        <MemoryRouter>
          <Sidebar />
        </MemoryRouter>
      );

      // Foundation Status hidden
      expect(screen.queryByText('Foundation Status')).toBeNull();
      // Revenue / Finance hidden
      expect(screen.queryByText('Revenue')).toBeNull();
      expect(screen.queryByText('Receita')).toBeNull();
      expect(screen.queryByText('Finance')).toBeNull();
      expect(screen.queryByText('Financial Ledger')).toBeNull();
      expect(screen.queryByText('Financial Records')).toBeNull();
      // Lead Scoring hidden
      expect(screen.queryByText('Lead Scoring')).toBeNull();
      // Reports, Course Operations & Alumni hidden from primary menu
      expect(screen.queryByText('Reports')).toBeNull();
      expect(screen.queryByText('Course Operations')).toBeNull();
      expect(screen.queryByText('Post-Course & Alumni')).toBeNull();
    });

    it('aligns MobileMenuSheet with the 7 operational items and hides technical/financial items', () => {
      render(
        <MemoryRouter>
          <MobileMenuSheet isOpen={true} onClose={vi.fn()} />
        </MemoryRouter>
      );

      // Visible items in mobile drawer
      expect(screen.getByText('Dashboard')).toBeDefined();
      expect(screen.getByText('Conversas')).toBeDefined();
      expect(screen.getByText('Templates')).toBeDefined();
      expect(screen.getByText('Configurações')).toBeDefined();

      // Hidden items
      expect(screen.queryByText('Foundation Status')).toBeNull();
      expect(screen.queryByText('Revenue')).toBeNull();
      expect(screen.queryByText('Lead Scoring')).toBeNull();
    });

    it('localizes sign-out button to "Sair" in both desktop and mobile navigation', () => {
      const { unmount } = render(
        <MemoryRouter>
          <Sidebar />
        </MemoryRouter>
      );
      expect(screen.getByText('Sair')).toBeDefined();
      expect(screen.queryByText('Sign out')).toBeNull();
      unmount();

      render(
        <MemoryRouter>
          <MobileMenuSheet isOpen={true} onClose={vi.fn()} />
        </MemoryRouter>
      );
      expect(screen.getByText('Sair')).toBeDefined();
      expect(screen.queryByText('Sign out')).toBeNull();
    });
  });

  // ===========================================================================
  // 2. PAYMENT TASK PRESERVATION (COMMERCIAL REMINDER ONLY)
  // ===========================================================================
  describe('2. Operational Payment Task Preservation', () => {
    it('preserves "Pagamento" quick action button in LeadQuickActionBar with reminder semantics', () => {
      const dummyLead = { id: 'lead-1', first_name: 'Ana', last_name: 'Silva', email: 'ana@example.com' } as any;
      const onOpenPaymentModal = vi.fn();

      render(
        <MemoryRouter>
          <LeadQuickActionBar
            lead={dummyLead}
            onOpenTaskModal={vi.fn()}
            onOpenPaymentModal={onOpenPaymentModal}
          />
        </MemoryRouter>
      );

      const paymentBtn = screen.getByRole('button', { name: /Pagamento/i });
      expect(paymentBtn).toBeDefined();
      expect(paymentBtn.getAttribute('title')).toBe('Agendar lembrete operacional de pagamento');

      fireEvent.click(paymentBtn);
      expect(onOpenPaymentModal).toHaveBeenCalledTimes(1);
    });

    it('preserves "Pagamento" in LeadTaskModal as reminder without creating financial records', async () => {
      const { createCrmTask } = await import('../features/work/services/work-queue-service');

      render(
        <MemoryRouter>
          <LeadTaskModal
            isOpen={true}
            onClose={vi.fn()}
            leadId="lead-1"
            leadName="Ana Silva"
            mode="payment"
            onTaskCreated={vi.fn()}
          />
        </MemoryRouter>
      );

      expect(screen.getByText(/Pagamento \(Lembrete\)/i)).toBeDefined();
      expect(
        screen.getByText(/Lembrete operacional para acompanhamento de pagamento deste lead/i)
      ).toBeDefined();

      // Submit modal
      const submitBtn = screen.getByRole('button', { name: /Criar tarefa/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(createCrmTask).toHaveBeenCalledWith(
          expect.objectContaining({
            leadId: 'lead-1',
            taskType: 'payment',
          })
        );
      });
    });

    it('completing payment task does not trigger revenue calculation or financial mutations', async () => {
      const { completeCrmTask } = await import('../features/work/services/work-queue-service');
      const result = await completeCrmTask('task-123');

      expect(result.success).toBe(true);
      expect(result.task_id).toBe('task-123');
      expect((result as any).revenue).toBeUndefined();
      expect((result as any).receivable_id).toBeUndefined();
      expect((result as any).financial_record_id).toBeUndefined();
    });
  });

  // ===========================================================================
  // 3. DASHBOARD OPERATIONAL HOME & REMOVAL OF FINANCIAL CLUTTER
  // ===========================================================================
  describe('3. Dashboard Operational Home Screen', () => {
    it('renders Dashboard as canonical home with Portuguese operational header', async () => {
      render(
        <MemoryRouter>
          <SalesDashboardPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('PAINEL OPERACIONAL')).toBeDefined();
        expect(screen.getAllByText('Dashboard').length).toBeGreaterThan(0);
        expect(screen.getByText('Acompanhamento diário de leads, pipeline, tarefas e entregabilidade')).toBeDefined();
      });
    });

    it('renders the 5 core operational KPI cards in KpiCardsSection', () => {
      render(
        <MemoryRouter>
          <KpiCardsSection metrics={mockMetrics} incompleteCount={5} />
        </MemoryRouter>
      );

      // 1. Novos Leads
      expect(screen.getByText('Novos Leads')).toBeDefined();
      expect(screen.getByText('35')).toBeDefined();
      // 2. Tarefas de Hoje
      expect(screen.getByText('Tarefas de Hoje')).toBeDefined();
      expect(screen.getByText('3')).toBeDefined();
      // 3. Tarefas Atrasadas
      expect(screen.getByText('Tarefas Atrasadas')).toBeDefined();
      expect(screen.getByText('1')).toBeDefined();
      // 4. Novas Respostas
      expect(screen.getByText('Novas Respostas')).toBeDefined();
      expect(screen.getByText('18')).toBeDefined();
      // 5. Inscrições Não Concluídas
      expect(screen.getByText('Inscrições Não Concluídas')).toBeDefined();
      expect(screen.getByText('5')).toBeDefined();
    });

    it('renders canonical 5-stage pipeline summary without post-course or alumni stages', async () => {
      render(
        <MemoryRouter>
          <SalesDashboardPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        // 5 canonical stages
        expect(screen.getAllByText('Novo Lead').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Respondido').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Interessado').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Quente').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Matrícula').length).toBeGreaterThan(0);

        // Excluded alumni / post-course stages
        expect(screen.queryByText('Alumni')).toBeNull();
        expect(screen.queryByText('Post-Course')).toBeNull();
      });
    });

    it('strictly contains ZERO financial KPIs, zero revenue charts, and zero links to revenue', async () => {
      render(
        <MemoryRouter>
          <SalesDashboardPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        // No revenue or financial KPIs
        expect(screen.queryByText(/Net Revenue/i)).toBeNull();
        expect(screen.queryByText(/Ticket Médio/i)).toBeNull();
        expect(screen.queryByText(/Receita & Fechamento Comercial/i)).toBeNull();
        expect(screen.queryByText(/Faturamento/i)).toBeNull();
        expect(screen.queryByText(/Recebíveis/i)).toBeNull();
        expect(screen.queryByText(/Financial Ledger/i)).toBeNull();
        // No link to revenue dashboard
        expect(document.querySelector('a[href="/dashboard/revenue"]')).toBeNull();
      });
    });

    it('strictly hides Foundation technical diagnostics and raw provider status from client dashboard', async () => {
      render(
        <MemoryRouter>
          <SalesDashboardPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.queryByText(/Foundation Status/i)).toBeNull();
        expect(screen.queryByText(/SPF Details/i)).toBeNull();
        expect(screen.queryByText(/DKIM Details/i)).toBeNull();
        expect(screen.queryByText(/Webhook Diagnostics/i)).toBeNull();
      });
    });
  });

  // ===========================================================================
  // 4. DELIVERABILITY HEALTH & REPUTATION PROTECTION
  // ===========================================================================
  describe('4. Email Deliverability Health & Domain Reputation Protection', () => {
    it('returns "Dados insuficientes" when sample size is below minimum threshold (<50 sends)', () => {
      const result = classifyDeliverabilityHealth({
        sent: 25,
        delivered: 25,
        bounced: 0,
        complaints: 0,
        failed: 0,
        suppressed: 0,
      });

      expect(result.level).toBe('Dados insuficientes');
      expect(result.isSufficientData).toBe(false);
      expect(result.levelExplanation).toContain('Amostra insuficiente');
    });

    it('classifies deliverability health as "Excelente" when delivery rate >= 98% with zero complaints and low bounce', () => {
      const result = classifyDeliverabilityHealth({
        sent: 200,
        delivered: 198,
        bounced: 1,
        complaints: 0,
        failed: 1,
        suppressed: 0,
      });

      expect(result.level).toBe('Excelente');
      expect(result.isSufficientData).toBe(true);
      expect(result.rates.deliveryRate).toBeGreaterThanOrEqual(98);
      expect(result.rates.complaintRate).toBe(0);
    });

    it('single spam complaint triggers high-priority operational alert without blindly marking entire domain Critical', () => {
      const result = classifyDeliverabilityHealth({
        sent: 500,
        delivered: 495,
        bounced: 3,
        complaints: 1, // Single complaint out of 500
        failed: 1,
        suppressed: 1,
      });

      expect(result.alerts).toContain('Alerta: uma reclamação de spam foi registrada.');
      // 1 complaint out of 500 = 0.2% complaint rate -> falls into Attention, not Critical
      expect(result.level).toBe('Atenção');
    });

    it('renders high-priority alert banner in EmailHealthCard when spam complaints > 0', () => {
      const summaryWithComplaint: DeliverabilityHealthSummary = {
        ...mockDeliverabilityHealth,
        level: 'Atenção',
        metrics: {
          ...mockDeliverabilityHealth.metrics,
          complaints: 1,
        },
      };

      render(
        <MemoryRouter>
          <EmailHealthCard summary={summaryWithComplaint} />
        </MemoryRouter>
      );

      expect(screen.getByText('Alerta: uma reclamação de spam foi registrada.')).toBeDefined();
      expect(screen.getByText(/remetente afetado foi suprimido automaticamente/i)).toBeDefined();
    });

    it('suppresses recipients with complaint or hard bounce via resolveLeadDeliverabilityHealth', () => {
      // 1. Complaint suppression
      const complaintResult = resolveLeadDeliverabilityHealth({
        leadEmail: 'lead@example.com',
        suppressionReason: 'complaint',
      });
      expect(complaintResult.status).toBe('suprimido');
      expect(complaintResult.label).toBe('Suprimido');

      // 2. Hard bounce suppression
      const bounceResult = resolveLeadDeliverabilityHealth({
        leadEmail: 'lead2@example.com',
        suppressionReason: 'hard_bounce',
      });
      expect(bounceResult.status).toBe('suprimido');
      expect(bounceResult.label).toBe('Suprimido');
    });

    it('does NOT claim Gmail spam-folder placement or inbox placement from delivery status', () => {
      render(
        <MemoryRouter>
          <EmailHealthCard summary={mockDeliverabilityHealth} />
        </MemoryRouter>
      );

      // Verify explicit explanation note
      expect(
        screen.getByText(/Status "Entregue" confirma o recebimento pelo servidor de destino, mas não garante a pasta de entrada/i)
      ).toBeDefined();
      // Zero fake metrics
      expect(screen.queryByText(/Open Rate/i)).toBeNull();
      expect(screen.queryByText(/Taxa de Abertura/i)).toBeNull();
      expect(screen.queryByText(/Lido/i)).toBeNull();
    });

    it('calculates deliverability rates without fake Open/Read/Seen rates', () => {
      const rates = calculateDeliverabilityRates({
        sent: 100,
        delivered: 97,
        bounced: 2,
        complaints: 0,
        failed: 1,
        suppressed: 1,
      });

      expect(rates.deliveryRate).toBe(97);
      expect(rates.bounceRate).toBe(2);
      expect(rates.complaintRate).toBe(0);
      expect(rates.failureRate).toBe(1);
      expect((rates as any).openRate).toBeUndefined();
      expect((rates as any).readRate).toBeUndefined();
      expect((rates as any).seenRate).toBeUndefined();
    });

    it('includes future Google Postmaster extension point note', () => {
      render(
        <MemoryRouter>
          <EmailHealthCard summary={mockDeliverabilityHealth} />
        </MemoryRouter>
      );

      expect(screen.getByText(/Google Postmaster: extensão futura preparada/i)).toBeDefined();
    });
  });

  // ===========================================================================
  // 5. INCOMPLETE REGISTRATIONS & EMPTY STATES
  // ===========================================================================
  describe('5. Incomplete Registrations Widget & Empty States', () => {
    it('renders incomplete registrations widget with lead name, course, and action link', () => {
      const items = [
        {
          id: 'inc-1',
          lead_id: 'lead-10',
          course_id: 'course-1',
          created_at: new Date().toISOString(),
          lead: { id: 'lead-10', first_name: 'Carlos', last_name: 'Mendes', email: 'carlos@example.com' },
          course: { id: 'course-1', name: 'Cirurgia Avançada', code: 'CIR-01' },
          course_session: { id: 'sess-1', title: 'Turma Março 2026', start_date: '2026-03-15' },
        },
      ];

      render(
        <MemoryRouter>
          <IncompleteEnrollmentsWidget items={items} />
        </MemoryRouter>
      );

      expect(screen.getByText('Inscrições Não Concluídas')).toBeDefined();
      expect(screen.getByText('Carlos Mendes')).toBeDefined();
      expect(screen.getByText('Cirurgia Avançada')).toBeDefined();
      expect(screen.getByText('Resolver')).toBeDefined();
    });

    it('renders neutral Portuguese empty state when no incomplete registrations are pending', () => {
      render(
        <MemoryRouter>
          <IncompleteEnrollmentsWidget items={[]} />
        </MemoryRouter>
      );

      expect(screen.getByText('Tudo em dia!')).toBeDefined();
      expect(screen.getByText('Nenhuma inscrição pendente de acompanhamento.')).toBeDefined();
    });
  });
});
