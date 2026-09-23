import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PipelineKanbanPage } from '../features/pipeline/PipelineKanbanPage';
import { LeadsListPage } from '../features/leads/LeadsListPage';
import { supabase } from '../lib/supabase';

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
    range: vi.fn(() => Promise.resolve(resolvedResult)),
    then: (resolve: any) => Promise.resolve(resolvedResult).then(resolve),
  };
  return mock;
}

describe('Mobile Kanban Pipeline & Standardized Contact Cards', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock scrollIntoView for DOM elements
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

      // Wait for stages and leads to load
      await waitFor(() => {
        expect(screen.getByText('Dra. Vanessa Menezes')).toBeInTheDocument();
      });

      // Verify all 5 stage columns are present with IDs for snapping and scrolling
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

      // Verify column styling classes for comfortable mobile width and snap-center
      expect(colCapture?.className).toContain('w-[84vw]');
      expect(colCapture?.className).toContain('snap-center');

      // Verify lead cards inside their respective columns
      expect(colCapture).toHaveTextContent('Dra. Vanessa Menezes');
      expect(colApp).toHaveTextContent('Dr. Roberto Albuquerque');

      // Verify empty stage indicators
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

      // Find quick-jump button for 'Matrícula'
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
  });

  // ---------------------------------------------------------------------------
  // 2. Contatos Standardized Mobile Cards
  // ---------------------------------------------------------------------------
  describe('Contatos Standardized Mobile Cards', () => {
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

      // Check Mobile Stack Container exists
      const mobileStack = document.querySelector('.sm\\:hidden.space-y-2\\.5');
      expect(mobileStack).toBeInTheDocument();

      // Lead 1: With course interest
      expect(mobileStack).toHaveTextContent('Dra. Camila Nogueira');
      expect(mobileStack).toHaveTextContent('(11) 97777-8888');
      expect(mobileStack).toHaveTextContent('camila@odontoclinic.com');
      expect(mobileStack).toHaveTextContent('Imersão em Facetas');

      // Lead 2: Without course interest -> discrete fallback 'Sem curso de interesse'
      expect(mobileStack).toHaveTextContent('Dr. Lucas Ferreira');
      expect(mobileStack).toHaveTextContent('(31) 96666-5555');
      expect(mobileStack).toHaveTextContent('lucas@exemplo.com');
      expect(mobileStack).toHaveTextContent('Sem curso de interesse');

      // Check discrete stage badges inside the mobile cards
      expect(mobileStack).toHaveTextContent('Novo Lead');
      expect(mobileStack).toHaveTextContent('Quente');
    });
  });
});
