import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PipelineKanbanPage } from '../features/pipeline/PipelineKanbanPage';
import { LeadsListPage } from '../features/leads/LeadsListPage';
import { MinimalLeadCard } from '../features/pipeline/components/MinimalLeadCard';
import { LeadProfileDrawer } from '../features/leads/components/LeadProfileDrawer';
import { LeadConversationStatus } from '../features/leads/components/LeadConversationStatus';
import { LeadQuickActionBar } from '../features/leads/components/LeadQuickActionBar';
import { MobileHeader } from '../components/MobileHeader';
import { MobileBottomNav } from '../components/MobileBottomNav';
import { Layout } from '../components/Layout';
import { WorkItemCard } from '../features/work/components/WorkItemCard';
import { supabase } from '../lib/supabase';
import type { Lead } from '../types';

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

// Mock Supabase
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

function createChainableMock(data: any = [], count?: number) {
  const resolvedResult = { data, count: count ?? (Array.isArray(data) ? data.length : 0), error: null };
  const mock: any = {
    select: vi.fn(() => mock),
    order: vi.fn(() => mock),
    in: vi.fn(() => mock),
    eq: vi.fn(() => mock),
    limit: vi.fn(() => mock),
    single: vi.fn(() => Promise.resolve({ data: Array.isArray(data) ? data[0] : data, error: null })),
    maybeSingle: vi.fn(() => Promise.resolve({ data: Array.isArray(data) ? data[0] : data, error: null })),
    range: vi.fn(() => Promise.resolve(resolvedResult)),
    then: (resolve: any) => Promise.resolve(resolvedResult).then(resolve),
  };
  return mock;
}

const mockLeadWithCourse: Lead = {
  id: 'lead-test-1',
  first_name: 'Dra. Camila',
  last_name: 'Nogueira',
  email: 'camila@odontoclinic.com',
  email_confirmation: null,
  phone_e164: '+5511977778888',
  phone_raw: '(11) 97777-8888',
  contact_preference: 'email',
  pipeline_stage_id: 'stage-1',
  qualification_status: 'interested',
  course_interest: 'Harmonização Avançada',
  course_interests: ['Harmonização Avançada'],
  source: 'meta',
  external_lead_id: null,
  hubspot_contact_id: null,
  source_created_at: null,
  lead_score: 90,
  created_at: '2026-03-01T10:00:00Z',
  updated_at: '2026-03-01T10:00:00Z',
};

const mockLeadWithoutCourse: Lead = {
  id: 'lead-test-2',
  first_name: 'Dr. Lucas',
  last_name: 'Ferreira',
  email: 'lucas@exemplo.com',
  email_confirmation: null,
  phone_e164: '+5531966665555',
  phone_raw: '(31) 96666-5555',
  contact_preference: 'call',
  pipeline_stage_id: 'stage-4',
  qualification_status: 'hot',
  course_interest: null,
  course_interests: [],
  source: 'manual',
  external_lead_id: null,
  hubspot_contact_id: null,
  source_created_at: null,
  lead_score: 40,
  created_at: '2026-03-02T10:00:00Z',
  updated_at: '2026-03-02T10:00:00Z',
};

describe('Mobile Kanban Pipeline & Standardized Contact Cards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockReset();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  // ---------------------------------------------------------------------------
  // 1. Mobile Kanban Pipeline
  // ---------------------------------------------------------------------------
  describe('Pipeline Mobile Kanban Format', () => {
    const mockStages = [
      { id: 'stage-1', code: 'capture', name: 'Novo Lead', sort_order: 1 },
      { id: 'stage-2', code: 'qualification', name: 'Respondido', sort_order: 2 },
      { id: 'stage-3', code: 'acquisition', name: 'Interessado', sort_order: 3 },
      { id: 'stage-4', code: 'approval', name: 'Quente', sort_order: 4 },
      { id: 'stage-5', code: 'enrollment', name: 'Matrícula', sort_order: 5 },
    ];

    const mockLeads = [
      {
        id: 'lead-1',
        first_name: 'Dra. Vanessa',
        last_name: 'Menezes',
        email: 'vanessa@example.com',
        phone_raw: '(11) 98765-4321',
        pipeline_stage_id: 'stage-1',
        created_at: '2026-03-01T10:00:00Z',
        updated_at: '2026-03-01T10:00:00Z',
      },
      {
        id: 'lead-2',
        first_name: 'Dr. Roberto',
        last_name: 'Albuquerque',
        email: 'roberto@example.com',
        phone_raw: '(21) 99888-7766',
        pipeline_stage_id: 'stage-4',
        created_at: '2026-03-02T10:00:00Z',
        updated_at: '2026-03-02T10:00:00Z',
      },
    ];

    it('renders all 5 operational stage columns horizontally with stage headers and counters', async () => {
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'pipeline_stages') return createChainableMock(mockStages);
        if (table === 'leads') return createChainableMock(mockLeads);
        if (table === 'lead_course_interests') {
          return createChainableMock([
            {
              lead_id: 'lead-1',
              priority: 1,
              course: { name: 'Harmonização Orofacial Avançada' },
              session: { title: 'Turma Abril 2026', start_date: '2026-04-15' },
            },
          ]);
        }
        if (table === 'lead_activities') return createChainableMock([]);
        return createChainableMock([]);
      });

      render(
        <MemoryRouter>
          <PipelineKanbanPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Dra. Vanessa Menezes')).toBeInTheDocument();
      });

      const colCapture = document.getElementById('kanban-col-capture');
      const colQual = document.getElementById('kanban-col-qualification');
      const colAcq = document.getElementById('kanban-col-acquisition');
      const colApp = document.getElementById('kanban-col-approval');
      const colEnr = document.getElementById('kanban-col-enrollment');

      expect(colCapture).toBeInTheDocument();
      expect(colQual).toBeInTheDocument();
      expect(colAcq).toBeInTheDocument();
      expect(colApp).toBeInTheDocument();
      expect(colEnr).toBeInTheDocument();

      expect(colCapture?.className).toContain('w-[84vw]');
      expect(colCapture?.className).toContain('snap-center');

      expect(colCapture).toHaveTextContent('Dra. Vanessa Menezes');
      expect(colApp).toHaveTextContent('Dr. Roberto Albuquerque');

      expect(colQual).toHaveTextContent('Nenhum lead neste estágio');
      expect(colAcq).toHaveTextContent('Nenhum lead neste estágio');
      expect(colEnr).toHaveTextContent('Nenhum lead neste estágio');
    });

    it('provides mobile quick-jump stage buttons that scroll to column when clicked', async () => {
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'pipeline_stages') return createChainableMock(mockStages);
        if (table === 'leads') return createChainableMock(mockLeads);
        return createChainableMock([]);
      });

      render(
        <MemoryRouter>
          <PipelineKanbanPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Dra. Vanessa Menezes')).toBeInTheDocument();
      });

      const matriculaButtons = screen.getAllByRole('button', { name: /Matrícula/i });
      expect(matriculaButtons.length).toBeGreaterThan(0);

      const quickJumpBtn = matriculaButtons[0];
      fireEvent.click(quickJumpBtn);

      const colEnr = document.getElementById('kanban-col-enrollment');
      expect(colEnr?.scrollIntoView).toHaveBeenCalledWith({
        behavior: 'smooth',
        inline: 'center',
        block: 'nearest',
      });
    });

    it('opens complete LeadProfileDrawer without navigating away when a Pipeline card is clicked', async () => {
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'pipeline_stages') return createChainableMock(mockStages);
        if (table === 'leads') return createChainableMock(mockLeads);
        if (table === 'conversations') return createChainableMock([]);
        if (table === 'lead_course_interests') return createChainableMock([]);
        if (table === 'lead_activities') return createChainableMock([]);
        if (table === 'tasks') return createChainableMock([]);
        if (table === 'lead_notes') return createChainableMock([]);
        if (table === 'enrollments') return createChainableMock([]);
        return createChainableMock([]);
      });

      render(
        <MemoryRouter>
          <PipelineKanbanPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Dra. Vanessa Menezes')).toBeInTheDocument();
      });

      const card = screen.getByText('Dra. Vanessa Menezes').closest('div[role="article"]');
      expect(card).toBeInTheDocument();
      fireEvent.click(card!);

      // Complete profile drawer opens immediately
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      const dialog = screen.getByRole('dialog');
      // All functional tabs and quick actions immediately available without secondary step
      expect(within(dialog).getByText('Resumo')).toBeInTheDocument();
      expect(within(dialog).getByText('Conversas')).toBeInTheDocument();
      expect(within(dialog).getByText('Atividades')).toBeInTheDocument();
      expect(within(dialog).getByText('Tarefas')).toBeInTheDocument();

      // Quick action bar is immediately present
      expect(within(dialog).getByRole('button', { name: /Ligar/i })).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: /WhatsApp/i })).toBeInTheDocument();

      // Should NOT have navigated immediately away
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Pipeline Lead Card (MinimalLeadCard) & Click vs Drag Separation
  // ---------------------------------------------------------------------------
  describe('Pipeline Lead Card (MinimalLeadCard)', () => {
    it('shows Nome, Telefone, E-mail, and Curso de Interesse', () => {
      render(
        <MemoryRouter>
          <MinimalLeadCard
            lead={mockLeadWithCourse}
            interests={[
              {
                courseName: 'Harmonização Avançada',
                startDate: '2026-05-15',
                priority: 1,
              },
            ]}
          />
        </MemoryRouter>
      );

      expect(screen.getByText('Dra. Camila Nogueira')).toBeInTheDocument();
      expect(screen.getByText('(11) 97777-8888')).toBeInTheDocument();
      expect(screen.getByText('camila@odontoclinic.com')).toBeInTheDocument();
      expect(screen.getByText(/Harmonização Avançada/i)).toBeInTheDocument();
    });

    it('shows fallback "Sem curso de interesse" when course is missing', () => {
      render(
        <MemoryRouter>
          <MinimalLeadCard lead={mockLeadWithoutCourse} />
        </MemoryRouter>
      );

      expect(screen.getByText('Dr. Lucas Ferreira')).toBeInTheDocument();
      expect(screen.getByText('(31) 96666-5555')).toBeInTheDocument();
      expect(screen.getByText('lucas@exemplo.com')).toBeInTheDocument();
      expect(screen.getByText('Sem curso de interesse')).toBeInTheDocument();
    });

    it('phone and email on card are DISPLAY ONLY (no tel or mailto links) and clicking them opens profile', () => {
      const onClick = vi.fn();
      render(
        <MemoryRouter>
          <MinimalLeadCard lead={mockLeadWithCourse} onClick={onClick} />
        </MemoryRouter>
      );

      // Verify no tel: or mailto: links on the card
      const telLinks = document.querySelectorAll('a[href^="tel:"]');
      const mailtoLinks = document.querySelectorAll('a[href^="mailto:"]');
      expect(telLinks.length).toBe(0);
      expect(mailtoLinks.length).toBe(0);

      // Clicking phone text bubbles up to card onClick
      const phoneText = screen.getByText('(11) 97777-8888');
      fireEvent.click(phoneText);
      expect(onClick).toHaveBeenCalledTimes(1);

      // Clicking email text bubbles up to card onClick
      const emailText = screen.getByText('camila@odontoclinic.com');
      fireEvent.click(emailText);
      expect(onClick).toHaveBeenCalledTimes(2);
    });

    it('dragging card does NOT trigger onClick upon release', () => {
      const onClick = vi.fn();
      render(
        <MemoryRouter>
          <MinimalLeadCard lead={mockLeadWithCourse} onClick={onClick} />
        </MemoryRouter>
      );

      const card = screen.getByRole('article');

      fireEvent.dragStart(card, {
        dataTransfer: {
          setData: vi.fn(),
          effectAllowed: 'move',
        },
      });

      fireEvent.click(card);
      expect(onClick).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Contatos Standardized Mobile Cards & Lead Quick View Restoration
  // ---------------------------------------------------------------------------
  describe('Contatos Standardized Mobile Cards & Lead Quick View Restoration', () => {
    const mockStages = [
      { id: 'stage-1', code: 'capture', name: 'Novo Lead', sort_order: 1 },
      { id: 'stage-4', code: 'approval', name: 'Quente', sort_order: 4 },
    ];

    const mockLeads = [
      {
        id: 'lead-1',
        first_name: 'Dra. Camila',
        last_name: 'Nogueira',
        email: 'camila@odontoclinic.com',
        phone_raw: '(11) 97777-8888',
        pipeline_stage_id: 'stage-1',
        lead_course_interests: [
          {
            priority: 1,
            course: { name: 'Imersão em Facetas' },
            session: { start_date: '2026-05-10' },
          },
        ],
        created_at: '2026-03-01T10:00:00Z',
      },
      {
        id: 'lead-2',
        first_name: 'Dr. Lucas',
        last_name: 'Ferreira',
        email: 'lucas@exemplo.com',
        phone_raw: '(31) 96666-5555',
        pipeline_stage_id: 'stage-4',
        lead_course_interests: [],
        course_interest: null,
        created_at: '2026-03-02T10:00:00Z',
      },
    ];

    it('renders mobile cards with Nome, Telefone, E-mail, and Curso de Interesse (or fallback)', async () => {
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'pipeline_stages') return createChainableMock(mockStages);
        if (table === 'courses' || table === 'course_sessions' || table === 'tags') return createChainableMock([]);
        if (table === 'leads') return createChainableMock(mockLeads, 2);
        return createChainableMock([]);
      });

      render(
        <MemoryRouter>
          <LeadsListPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getAllByText('Dra. Camila Nogueira').length).toBeGreaterThan(0);
      });

      const mobileStack = document.querySelector('.sm\\:hidden.space-y-2\\.5');
      expect(mobileStack).toBeInTheDocument();

      // Lead 1
      expect(mobileStack).toHaveTextContent('Dra. Camila Nogueira');
      expect(mobileStack).toHaveTextContent('(11) 97777-8888');
      expect(mobileStack).toHaveTextContent('camila@odontoclinic.com');
      expect(mobileStack).toHaveTextContent('Imersão em Facetas');

      // Lead 2
      expect(mobileStack).toHaveTextContent('Dr. Lucas Ferreira');
      expect(mobileStack).toHaveTextContent('(31) 96666-5555');
      expect(mobileStack).toHaveTextContent('lucas@exemplo.com');
      expect(mobileStack).toHaveTextContent('Sem curso de interesse');

      // Discrete stage badges
      expect(mobileStack).toHaveTextContent('Novo Lead');
      expect(mobileStack).toHaveTextContent('Quente');
    });

    it('opens complete LeadProfileDrawer without navigating away when mobile contact card is clicked', async () => {
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'pipeline_stages') return createChainableMock(mockStages);
        if (table === 'courses' || table === 'course_sessions' || table === 'tags') return createChainableMock([]);
        if (table === 'leads') return createChainableMock(mockLeads, 2);
        if (table === 'conversations') return createChainableMock([]);
        if (table === 'lead_activities') return createChainableMock([]);
        if (table === 'tasks') return createChainableMock([]);
        if (table === 'lead_notes') return createChainableMock([]);
        if (table === 'enrollments') return createChainableMock([]);
        return createChainableMock([]);
      });

      render(
        <MemoryRouter>
          <LeadsListPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getAllByText('Dra. Camila Nogueira').length).toBeGreaterThan(0);
      });

      const mobileCards = document.querySelectorAll('.sm\\:hidden.space-y-2\\.5 > div');
      expect(mobileCards.length).toBe(2);

      fireEvent.click(mobileCards[0]);

      // Complete profile drawer opens immediately
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByText('Resumo')).toBeInTheDocument();
      expect(within(dialog).getByText('Conversas')).toBeInTheDocument();
      expect(within(dialog).getByText('Atividades')).toBeInTheDocument();
      expect(within(dialog).getByText('Tarefas')).toBeInTheDocument();
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('opens complete LeadProfileDrawer when desktop table row is clicked', async () => {
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'pipeline_stages') return createChainableMock(mockStages);
        if (table === 'courses' || table === 'course_sessions' || table === 'tags') return createChainableMock([]);
        if (table === 'leads') return createChainableMock(mockLeads, 2);
        if (table === 'conversations') return createChainableMock([]);
        if (table === 'lead_activities') return createChainableMock([]);
        if (table === 'tasks') return createChainableMock([]);
        if (table === 'lead_notes') return createChainableMock([]);
        if (table === 'enrollments') return createChainableMock([]);
        return createChainableMock([]);
      });

      render(
        <MemoryRouter>
          <LeadsListPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getAllByText('Dra. Camila Nogueira').length).toBeGreaterThan(0);
      });

      const desktopRows = document.querySelectorAll('tbody tr');
      expect(desktopRows.length).toBe(2);

      fireEvent.click(desktopRows[0]);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      const desktopDialog = screen.getByRole('dialog');
      expect(within(desktopDialog).getByText('Resumo')).toBeInTheDocument();
      expect(within(desktopDialog).getByText('Conversas')).toBeInTheDocument();
      expect(within(desktopDialog).getByText('Atividades')).toBeInTheDocument();
      expect(within(desktopDialog).getByText('Tarefas')).toBeInTheDocument();
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('phone and email in contact card are DISPLAY ONLY (no tel: or mailto: anchors) and clicking card opens drawer', async () => {
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'pipeline_stages') return createChainableMock(mockStages);
        if (table === 'courses' || table === 'course_sessions' || table === 'tags') return createChainableMock([]);
        if (table === 'leads') return createChainableMock(mockLeads, 2);
        if (table === 'conversations') return createChainableMock([]);
        if (table === 'lead_activities') return createChainableMock([]);
        if (table === 'tasks') return createChainableMock([]);
        if (table === 'lead_notes') return createChainableMock([]);
        if (table === 'enrollments') return createChainableMock([]);
        return createChainableMock([]);
      });

      render(
        <MemoryRouter>
          <LeadsListPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getAllByText('Dra. Camila Nogueira').length).toBeGreaterThan(0);
      });

      // No tel: or mailto: links in the entire list table/cards
      const telLinks = document.querySelectorAll('a[href^="tel:"]');
      const mailtoLinks = document.querySelectorAll('a[href^="mailto:"]');
      expect(telLinks.length).toBe(0);
      expect(mailtoLinks.length).toBe(0);

      // Mobile card click opens drawer
      const mobileCard = document.querySelectorAll('.sm\\:hidden.space-y-2\\.5 > div')[0];
      fireEvent.click(mobileCard);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
      const clickDialog = screen.getByRole('dialog');
      expect(within(clickDialog).getByText('Resumo')).toBeInTheDocument();
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Complete Lead Profile Content & Immediate 4-Tab Accessibility
  // ---------------------------------------------------------------------------
  describe('Complete Lead Profile Content & Immediate 4-Tab Accessibility', () => {
    it('LeadProfileDrawer immediately renders complete profile data and all 4 functional tabs without intermediate step', () => {
      render(
        <MemoryRouter>
          <LeadProfileDrawer
            leadId="lead-test-1"
            isOpen={true}
            initialLead={mockLeadWithCourse}
            onClose={vi.fn()}
          />
        </MemoryRouter>
      );

      // Name and Stage in header
      expect(screen.getByText('Dra. Camila Nogueira')).toBeInTheDocument();

      // Quick Actions immediately available
      expect(screen.getByRole('button', { name: /Ligar/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Email/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /SMS/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /WhatsApp/i })).toBeInTheDocument();

      // All 4 tabs immediately available
      expect(screen.getByText('Resumo')).toBeInTheDocument();
      expect(screen.getByText('Conversas')).toBeInTheDocument();
      expect(screen.getByText('Atividades')).toBeInTheDocument();
      expect(screen.getByText('Tarefas')).toBeInTheDocument();

      // Contact details displayed inside profile
      expect(screen.getByText('(11) 97777-8888')).toBeInTheDocument();
      expect(screen.getByText('camila@odontoclinic.com')).toBeInTheDocument();
    });

    it('renders factual stored conversation when available without fake read status', async () => {
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'conversations') {
          return createChainableMock([
            {
              id: 'conv-1',
              lead_id: 'lead-test-1',
              channel: 'email',
              subject: 'Dúvidas Harmonização',
              last_message_at: '2026-03-01T14:30:00Z',
              last_message_preview: 'Gostaria de saber o valor da matrícula',
              last_message_direction: 'inbound',
              status: 'open',
            },
          ]);
        }
        return createChainableMock([]);
      });

      render(
        <MemoryRouter>
          <LeadConversationStatus leadId="lead-test-1" />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText(/Gostaria de saber o valor da matrícula/i)).toBeInTheDocument();
      });

      expect(screen.getByText('Recebida')).toBeInTheDocument();
      expect(screen.queryByText(/Lido/i)).toBeNull();
      expect(screen.queryByText(/Visualizado/i)).toBeNull();
    });

    it('renders clean empty state when no conversation exists', async () => {
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'conversations') {
          return createChainableMock([]);
        }
        return createChainableMock([]);
      });

      render(
        <MemoryRouter>
          <LeadConversationStatus leadId="lead-test-1" />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Nenhuma conversa registrada')).toBeInTheDocument();
      });
    });

    it('Payment quick action opens payment reminder task modal without replacing with Matrícula', () => {
      const onOpenPaymentModal = vi.fn();
      render(
        <LeadQuickActionBar
          lead={mockLeadWithCourse}
          onOpenTaskModal={vi.fn()}
          onOpenPaymentModal={onOpenPaymentModal}
        />
      );

      const paymentBtn = screen.getByRole('button', { name: /Pagamento/i });
      expect(paymentBtn).toBeInTheDocument();
      expect(paymentBtn).toHaveAttribute('title', 'Agendar lembrete operacional de pagamento');

      fireEvent.click(paymentBtn);
      expect(onOpenPaymentModal).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Global Back Navigation & MobileHeader
  // ---------------------------------------------------------------------------
  describe('Global Back Navigation & MobileHeader', () => {
    it('renders MobileHeader with back button and navigates to fallback when clicked', () => {
      render(
        <MemoryRouter>
          <MobileHeader title="Perfil do Lead" backTo="/leads" />
        </MemoryRouter>
      );

      expect(screen.getByText('Perfil do Lead')).toBeInTheDocument();
      const backBtn = screen.getByLabelText('Voltar');
      expect(backBtn).toBeInTheDocument();

      fireEvent.click(backBtn);
      expect(mockNavigate).toHaveBeenCalledWith('/leads', { replace: true });
    });

    it('Layout renders desktop back button and breadcrumb when backTo is provided', () => {
      render(
        <MemoryRouter>
          <Layout title="Editor de Campanha" backTo="/campaigns">
            <div>Content</div>
          </Layout>
        </MemoryRouter>
      );

      expect(screen.getByLabelText('Voltar')).toBeInTheDocument();
      expect(screen.getByText('EDS HUB')).toBeInTheDocument();
      expect(screen.getAllByText('Editor de Campanha').length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Mobile Bottom Navigation & Invariant Protection
  // ---------------------------------------------------------------------------
  describe('Mobile Bottom Navigation', () => {
    it('renders exactly 4 navigation destinations: Contatos, Pipeline, Tarefas, and Menu', () => {
      render(
        <MemoryRouter>
          <MobileBottomNav onOpenMenu={vi.fn()} />
        </MemoryRouter>
      );

      expect(screen.getByText('Contatos')).toBeInTheDocument();
      expect(screen.getByText('Pipeline')).toBeInTheDocument();
      expect(screen.getByText('Tarefas')).toBeInTheDocument();
      expect(screen.getByText('Menu')).toBeInTheDocument();
    });

    it('never hides bottom nav without a top back button (Layout invariant)', () => {
      const { unmount } = render(
        <MemoryRouter>
          <Layout title="Primary Screen" hideBottomNav={true}>
            <div>Primary</div>
          </Layout>
        </MemoryRouter>
      );

      expect(document.getElementById('mobile-bottom-nav')).toBeInTheDocument();
      unmount();

      render(
        <MemoryRouter>
          <Layout title="Secondary Screen" hideBottomNav={true} backTo="/leads">
            <div>Secondary</div>
          </Layout>
        </MemoryRouter>
      );

      expect(document.getElementById('mobile-bottom-nav')).not.toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Lead Card Display-Only Contacts & Explicit Actions in Lead Profile
  // ---------------------------------------------------------------------------
  describe('Lead Card Display-Only Contacts & Explicit Actions in Lead Profile', () => {
    it('phone and email in MinimalLeadCard have NO tel: or mailto: anchors (display-only)', () => {
      render(
        <MemoryRouter>
          <MinimalLeadCard lead={mockLeadWithCourse} />
        </MemoryRouter>
      );

      // MinimalLeadCard contains only display-only elements for phone and email
      const telLinks = document.querySelectorAll('a[href^="tel:"]');
      const mailtoLinks = document.querySelectorAll('a[href^="mailto:"]');
      expect(telLinks.length).toBe(0);
      expect(mailtoLinks.length).toBe(0);

      expect(screen.getByText('(11) 97777-8888')).toBeInTheDocument();
      expect(screen.getByText('camila@odontoclinic.com')).toBeInTheDocument();
    });

    it('phone and email in Contatos mobile cards have NO tel: or mailto: anchors (display-only)', async () => {
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'pipeline_stages') return createChainableMock([{ id: 'stage-1', code: 'capture', name: 'Novo Lead', sort_order: 1 }]);
        if (table === 'courses' || table === 'course_sessions' || table === 'tags') return createChainableMock([]);
        if (table === 'leads') return createChainableMock([mockLeadWithCourse], 1);
        return createChainableMock([]);
      });

      render(
        <MemoryRouter>
          <LeadsListPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getAllByText('Dra. Camila Nogueira').length).toBeGreaterThan(0);
      });

      const telLinks = document.querySelectorAll('a[href^="tel:"]');
      const mailtoLinks = document.querySelectorAll('a[href^="mailto:"]');
      expect(telLinks.length).toBe(0);
      expect(mailtoLinks.length).toBe(0);
    });

    it('tapping card anywhere (name, course, phone, email, empty space) triggers card onClick to open Lead Profile', () => {
      const onClick = vi.fn();
      render(
        <MemoryRouter>
          <MinimalLeadCard lead={mockLeadWithCourse} onClick={onClick} />
        </MemoryRouter>
      );

      // 1. Tap lead name
      const nameEl = screen.getByText('Dra. Camila Nogueira');
      fireEvent.click(nameEl);
      expect(onClick).toHaveBeenCalledTimes(1);

      // 2. Tap course area
      const courseEl = screen.getByText(/Harmonização Avançada/i);
      fireEvent.click(courseEl);
      expect(onClick).toHaveBeenCalledTimes(2);

      // 3. Tap phone text
      const phoneEl = screen.getByText('(11) 97777-8888');
      fireEvent.click(phoneEl);
      expect(onClick).toHaveBeenCalledTimes(3);

      // 4. Tap email text
      const emailEl = screen.getByText('camila@odontoclinic.com');
      fireEvent.click(emailEl);
      expect(onClick).toHaveBeenCalledTimes(4);

      // 5. Tap empty card space
      const card = screen.getByRole('article');
      fireEvent.click(card);
      expect(onClick).toHaveBeenCalledTimes(5);
    });

    it('Quick Actions inside Lead Profile provide explicit external action buttons (Ligar -> tel:, Email -> mailto:, SMS -> sms:, WhatsApp -> wa.me)', () => {
      render(
        <LeadQuickActionBar
          lead={mockLeadWithCourse}
          onOpenTaskModal={vi.fn()}
          onOpenPaymentModal={vi.fn()}
        />
      );

      const ligarBtn = screen.getByRole('button', { name: /Ligar/i });
      const emailBtn = screen.getByRole('button', { name: /Email/i });
      const smsBtn = screen.getByRole('button', { name: /SMS/i });
      const whatsAppBtn = screen.getByRole('button', { name: /WhatsApp/i });

      expect(ligarBtn.getAttribute('href')).toBe('tel:+5511977778888');
      // Batch 7.3: canonical Email action opens internal composer, mailto is removed
      expect(emailBtn.getAttribute('href')).toBeNull();
      expect(smsBtn.getAttribute('href')).toBe('sms:+5511977778888');
      expect(whatsAppBtn.getAttribute('href')).toBe('https://wa.me/5511977778888');

      // Quick action buttons retain their full accessible layout class
      expect(ligarBtn.className).toContain('min-h-[40px]');
      expect(emailBtn.className).toContain('min-h-[40px]');
      expect(smsBtn.className).toContain('min-h-[40px]');
      expect(whatsAppBtn.className).toContain('min-h-[40px]');
    });

    it('clicking lead name inside Task item opens Lead Profile modal without route change', () => {
      const onSelectLead = vi.fn();
      const mockTaskItem: any = {
        id: 'task-1',
        type: 'TASK',
        category: 'pending',
        lead_id: 'lead-test-1',
        lead_name: 'Dra. Camila Nogueira',
        title: 'Retornar contato sobre curso',
        description: 'Lead pediu informações sobre a data de início',
        task_type: 'call_manual',
        priority: 'high',
        status: 'pending',
        due_at: '2026-03-01T15:00:00Z',
        created_at: '2026-03-01T10:00:00Z',
        time_status: 'due_today',
        is_overdue: false,
        source: 'manual',
      };

      render(
        <MemoryRouter>
          <WorkItemCard
            item={mockTaskItem}
            onCompleteTask={vi.fn()}
            onRescheduleTask={vi.fn()}
            onCreateTaskForLead={vi.fn()}
            onSelectLead={onSelectLead}
          />
        </MemoryRouter>
      );

      const leadBtn = screen.getByRole('button', { name: /Dra\. Camila Nogueira/i });
      expect(leadBtn).toBeInTheDocument();

      fireEvent.click(leadBtn);
      expect(onSelectLead).toHaveBeenCalledWith('lead-test-1');
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });
});
