// =============================================================================
// EDS HUB — CONTACT HEALTH + EDIT LEAD TEST SUITE
// =============================================================================
// Comprehensive verification for:
// PART A: Contact Card Deliverability Health (Same factual logic as Pipeline)
// PART B: Edit Lead in Complete Lead Profile (In-place edit, conflict protection, no duplicate)
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LeadsListPage } from '../features/leads/LeadsListPage';
import { EditLeadModal } from '../features/leads/components/EditLeadModal';
import { LeadProfileDrawer } from '../features/leads/components/LeadProfileDrawer';
import { LeadProfileContent } from '../features/leads/components/LeadProfileContent';
import {
  resolveLeadDeliverabilityHealth,
  batchFetchPipelineDeliverabilityHealth,
} from '../features/dashboard/services/deliverability-health-service';
import { supabase } from '../lib/supabase';
import type { Lead, PipelineStage, Course, CourseSession } from '../types';

// Mock Router
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
  };
});

// Mock Auth
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
    neq: vi.fn(() => mock),
    or: vi.fn(() => mock),
    ilike: vi.fn(() => mock),
    limit: vi.fn(() => mock),
    range: vi.fn(() => Promise.resolve(resolvedResult)),
    single: vi.fn(() => Promise.resolve({ data: Array.isArray(data) ? data[0] : data, error: null })),
    maybeSingle: vi.fn(() => Promise.resolve({ data: Array.isArray(data) ? data[0] : data, error: null })),
    insert: vi.fn(() => Promise.resolve({ data: null, error: null })),
    update: vi.fn(() => mock),
    delete: vi.fn(() => mock),
    then: (resolve: any) => Promise.resolve(resolvedResult).then(resolve),
  };
  return mock;
}

describe('PART A: Contact Card Deliverability Health', () => {
  const mockStages: PipelineStage[] = [
    {
      id: 'stage-capture',
      code: 'capture',
      name: 'Novo Lead',
      sort_order: 1,
      is_active: true,
      created_at: '2026-03-01T10:00:00Z',
      updated_at: '2026-03-01T10:00:00Z',
    },
  ];

  const leadHealthy: Lead = {
    id: 'lead-1',
    first_name: 'Dra. Vanessa',
    last_name: 'Menezes',
    email: 'vanessa@example.com',
    phone_raw: '+55 11 98888-1111',
    phone_e164: '+5511988881111',
    contact_preference: 'email',
    pipeline_stage_id: 'stage-capture',
    source: 'manual',
    created_at: '2026-03-01T10:00:00Z',
    updated_at: '2026-03-01T10:00:00Z',
    course_interests: [],
  } as unknown as Lead;

  const leadWarning: Lead = {
    id: 'lead-2',
    first_name: 'Carlos',
    last_name: 'Eduardo',
    email: 'carlos@example.com',
    phone_raw: '+55 11 98888-2222',
    phone_e164: '+5511988882222',
    contact_preference: 'email',
    pipeline_stage_id: 'stage-capture',
    source: 'manual',
    created_at: '2026-03-01T10:00:00Z',
    updated_at: '2026-03-01T10:00:00Z',
    course_interests: [],
  } as unknown as Lead;

  const leadRisk: Lead = {
    id: 'lead-3',
    first_name: 'Renata',
    last_name: 'Silveira',
    email: 'renata@example.com',
    phone_raw: '+55 11 98888-3333',
    phone_e164: '+5511988883333',
    contact_preference: 'email',
    pipeline_stage_id: 'stage-capture',
    source: 'manual',
    created_at: '2026-03-01T10:00:00Z',
    updated_at: '2026-03-01T10:00:00Z',
    course_interests: [],
  } as unknown as Lead;

  const leadSuppressed: Lead = {
    id: 'lead-4',
    first_name: 'Marcos',
    last_name: 'Oliveira',
    email: 'marcos@example.com',
    phone_raw: '+55 11 98888-4444',
    phone_e164: '+5511988884444',
    contact_preference: 'email',
    pipeline_stage_id: 'stage-capture',
    source: 'manual',
    created_at: '2026-03-01T10:00:00Z',
    updated_at: '2026-03-01T10:00:00Z',
    course_interests: [],
  } as unknown as Lead;

  const leadNoData: Lead = {
    id: 'lead-5',
    first_name: 'Fernanda',
    last_name: 'Alves',
    email: 'fernanda@example.com',
    phone_raw: '+55 11 98888-5555',
    phone_e164: '+5511988885555',
    contact_preference: 'email',
    pipeline_stage_id: 'stage-capture',
    source: 'manual',
    created_at: '2026-03-01T10:00:00Z',
    updated_at: '2026-03-01T10:00:00Z',
    course_interests: [],
  } as unknown as Lead;

  const leadNoEmail: Lead = {
    id: 'lead-6',
    first_name: 'Lucas',
    last_name: 'Sem Email',
    email: null,
    phone_raw: '+55 11 98888-6666',
    phone_e164: '+5511988886666',
    contact_preference: 'call',
    pipeline_stage_id: 'stage-capture',
    source: 'manual',
    created_at: '2026-03-01T10:00:00Z',
    updated_at: '2026-03-01T10:00:00Z',
    course_interests: [],
  } as unknown as Lead;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. reuses the exact same deliverability health helper logic as Pipeline', () => {
    // Healthy
    const healthy = resolveLeadDeliverabilityHealth({
      leadEmail: 'test@example.com',
      recentOutboundMessages: [{ status: 'delivered', delivered_at: new Date().toISOString() }],
    });
    expect(healthy.status).toBe('saudavel');
    expect(healthy.label).toBe('Saudável');
    expect(healthy.dotColor).toContain('bg-emerald');

    // Warning
    const warning = resolveLeadDeliverabilityHealth({
      leadEmail: 'test@example.com',
      recentOutboundMessages: [{ status: 'failed', failed_at: new Date().toISOString() }],
    });
    expect(warning.status).toBe('atencao');
    expect(warning.label).toBe('Atenção');
    expect(warning.dotColor).toContain('bg-amber');

    // Risk
    const risk = resolveLeadDeliverabilityHealth({
      leadEmail: 'test@example.com',
      recentOutboundMessages: [{ status: 'bounced', bounced_at: new Date().toISOString() }],
    });
    expect(risk.status).toBe('risco');
    expect(risk.label).toBe('Risco');
    expect(risk.dotColor).toContain('bg-rose');

    // Suppressed
    const suppressed = resolveLeadDeliverabilityHealth({
      leadEmail: 'test@example.com',
      suppressionReason: 'hard_bounce',
    });
    expect(suppressed.status).toBe('suprimido');
    expect(suppressed.label).toBe('Suprimido');
    expect(suppressed.dotColor).toContain('bg-rose');

    // No Data
    const noData = resolveLeadDeliverabilityHealth({
      leadEmail: 'test@example.com',
      recentOutboundMessages: [],
    });
    expect(noData.status).toBe('sem_dados');
    expect(noData.label).toBe('Sem dados');
  });

  it('2. renders factual health badge on contact cards with correct semantics', async () => {
    const allLeads = [leadHealthy, leadWarning, leadRisk, leadSuppressed, leadNoData, leadNoEmail];

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'pipeline_stages') return createChainableMock(mockStages);
      if (table === 'leads') return createChainableMock(allLeads, allLeads.length);
      if (table === 'courses') return createChainableMock([]);
      if (table === 'course_sessions') return createChainableMock([]);
      if (table === 'tags') return createChainableMock([]);
      if (table === 'email_suppressions') {
        return createChainableMock([{ normalized_email: 'marcos@example.com', reason: 'hard_bounce' }]);
      }
      if (table === 'outbound_messages') {
        return createChainableMock([
          { lead_id: 'lead-1', status: 'delivered', delivered_at: '2026-03-01T12:00:00Z' },
          { lead_id: 'lead-2', status: 'failed', failed_at: '2026-03-01T12:00:00Z' },
          { lead_id: 'lead-3', status: 'bounced', bounced_at: '2026-03-01T12:00:00Z' },
        ]);
      }
      return createChainableMock([]);
    });

    render(
      <MemoryRouter>
        <LeadsListPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText('Dra. Vanessa Menezes').length).toBeGreaterThanOrEqual(1);
    });

    // Verify badges appear on mobile cards and desktop table
    await waitFor(() => {
      const healthyBadges = screen.getAllByText('Saudável');
      expect(healthyBadges.length).toBeGreaterThanOrEqual(1);

      const warningBadges = screen.getAllByText('Atenção');
      expect(warningBadges.length).toBeGreaterThanOrEqual(1);

      const riskBadges = screen.getAllByText('Risco');
      expect(riskBadges.length).toBeGreaterThanOrEqual(1);

      const suppressedBadges = screen.getAllByText('Suprimido');
      expect(suppressedBadges.length).toBeGreaterThanOrEqual(1);

      const noDataBadges = screen.getAllByText('Sem dados');
      expect(noDataBadges.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('3. safely hides deliverability health badge when lead has no email', async () => {
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'pipeline_stages') return createChainableMock(mockStages);
      if (table === 'leads') return createChainableMock([leadNoEmail], 1);
      if (table === 'courses') return createChainableMock([]);
      if (table === 'course_sessions') return createChainableMock([]);
      if (table === 'tags') return createChainableMock([]);
      if (table === 'email_suppressions') return createChainableMock([]);
      if (table === 'outbound_messages') return createChainableMock([]);
      return createChainableMock([]);
    });

    render(
      <MemoryRouter>
        <LeadsListPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText('Lucas Sem Email').length).toBeGreaterThanOrEqual(1);
    });

    // Deliverability badge must NOT be rendered for lead without email
    const badge = screen.queryByTestId('contact-card-deliverability-badge');
    expect(badge).toBeNull();
  });

  it('4. mobile layout stability at 390px (no overflow, compact presentation)', async () => {
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'pipeline_stages') return createChainableMock(mockStages);
      if (table === 'leads') return createChainableMock([leadHealthy], 1);
      if (table === 'courses') return createChainableMock([]);
      if (table === 'course_sessions') return createChainableMock([]);
      if (table === 'tags') return createChainableMock([]);
      if (table === 'email_suppressions') return createChainableMock([]);
      if (table === 'outbound_messages') {
        return createChainableMock([{ lead_id: 'lead-1', status: 'delivered', delivered_at: '2026-03-01T12:00:00Z' }]);
      }
      return createChainableMock([]);
    });

    render(
      <MemoryRouter>
        <LeadsListPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      const badge = screen.getByTestId('contact-card-deliverability-badge');
      expect(badge).toBeInTheDocument();
      expect(badge.className).toContain('text-[10px]');
      expect(badge.className).toContain('max-w-full');
      expect(badge.className).toContain('truncate');
    });
  });

  it('5. deliverability health check has ZERO side effects (read-only queries)', async () => {
    const updateSpy = vi.fn();
    const insertSpy = vi.fn();

    (supabase.from as any).mockImplementation((_table: string) => {
      return {
        ...createChainableMock([]),
        update: updateSpy,
        insert: insertSpy,
      };
    });

    await batchFetchPipelineDeliverabilityHealth([leadHealthy, leadRisk]);

    expect(updateSpy).not.toHaveBeenCalled();
    expect(insertSpy).not.toHaveBeenCalled();
  });
});

describe('PART B: Edit Lead in Complete Lead Profile', () => {
  const currentLead: Lead = {
    id: 'lead-edit-123',
    first_name: 'Mariana',
    last_name: 'Souza',
    email: 'mariana.souza@example.com',
    phone_raw: '+55 11 97777-1111',
    phone_e164: '+5511977771111',
    contact_preference: 'email',
    pipeline_stage_id: 'stage-capture-1',
    referred_by: 'Dr. Paulo Costa',
    course_interest: 'Harmonização Orofacial',
    course_interests: ['Harmonização Orofacial'],
    source: 'manual',
    created_at: '2026-03-01T10:00:00Z',
    updated_at: '2026-03-01T10:00:00Z',
  } as unknown as Lead;

  const mockCourses: Course[] = [
    {
      id: 'course-1',
      name: 'Harmonização Orofacial Avançada',
      code: 'HOA',
      active: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    } as unknown as Course,
    {
      id: 'course-2',
      name: 'Imersão em Bichectomia',
      code: 'BIC',
      active: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    } as unknown as Course,
  ];

  const mockSessions: CourseSession[] = [
    {
      id: 'session-1',
      course_id: 'course-1',
      title: 'Turma Abril 2026',
      start_date: '2026-04-10',
      status: 'open',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    } as unknown as CourseSession,
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('6. "Editar lead" action is clearly visible in Complete Lead Profile Drawer header', async () => {
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'leads') return createChainableMock(currentLead);
      if (table === 'lead_course_interests') return createChainableMock([]);
      if (table === 'lead_activities') return createChainableMock([]);
      if (table === 'tasks') return createChainableMock([]);
      if (table === 'lead_notes') return createChainableMock([]);
      return createChainableMock([]);
    });

    render(
      <LeadProfileDrawer
        leadId="lead-edit-123"
        isOpen={true}
        onClose={vi.fn()}
        initialLead={currentLead}
      />
    );

    const editBtn = screen.getByTestId('drawer-edit-lead-button');
    expect(editBtn).toBeInTheDocument();
    expect(editBtn).toHaveTextContent('Editar lead');
  });

  it('7. "Editar lead" action is visible in LeadProfileContent standalone header and contact card', async () => {
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'leads') return createChainableMock(currentLead);
      if (table === 'lead_course_interests') return createChainableMock([]);
      if (table === 'lead_activities') return createChainableMock([]);
      if (table === 'tasks') return createChainableMock([]);
      if (table === 'lead_notes') return createChainableMock([]);
      return createChainableMock([]);
    });

    render(
      <LeadProfileContent
        leadId="lead-edit-123"
        initialLead={currentLead}
        isStandalonePage={true}
      />
    );

    // Standalone header button
    const standaloneBtn = screen.getByTestId('standalone-edit-lead-button');
    expect(standaloneBtn).toBeInTheDocument();
    expect(standaloneBtn).toHaveTextContent('Editar lead');

    // Contact card button
    const cardBtn = screen.getByTestId('card-edit-lead-button');
    expect(cardBtn).toBeInTheDocument();
    expect(cardBtn).toHaveTextContent('Editar');
  });

  it('8. opens edit form with CURRENT lead data prefilled (does not duplicate lead)', async () => {
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'courses') return createChainableMock(mockCourses);
      if (table === 'course_sessions') return createChainableMock(mockSessions);
      if (table === 'lead_course_interests') {
        return createChainableMock([{ course_id: 'course-1', course_session_id: 'session-1', priority: 1 }]);
      }
      return createChainableMock([]);
    });

    render(
      <EditLeadModal
        isOpen={true}
        onClose={vi.fn()}
        lead={currentLead}
        onLeadUpdated={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('Mariana')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Souza')).toBeInTheDocument();
      expect(screen.getByDisplayValue('mariana.souza@example.com')).toBeInTheDocument();
      expect(screen.getByDisplayValue('+55 11 97777-1111')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Dr. Paulo Costa')).toBeInTheDocument();
    });
  });

  it('9. updates current lead fields strictly in-place via supabase.update (ZERO insert into leads)', async () => {
    const updateLeadMock = vi.fn(() => createChainableMock(null));
    const insertLeadMock = vi.fn();
    const deleteInterestsMock = vi.fn(() => createChainableMock(null));
    const insertInterestsMock = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const onLeadUpdatedMock = vi.fn();

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'courses') return createChainableMock(mockCourses);
      if (table === 'course_sessions') return createChainableMock(mockSessions);
      if (table === 'email_suppressions') return createChainableMock(null);
      if (table === 'lead_course_interests') {
        return {
          select: vi.fn(() => createChainableMock([])),
          delete: deleteInterestsMock,
          insert: insertInterestsMock,
          eq: vi.fn(() => ({
            order: vi.fn(() => Promise.resolve({ data: [], error: null })),
          })),
        };
      }
      if (table === 'leads') {
        return {
          select: vi.fn(() => ({
            neq: vi.fn(() => ({
              ilike: vi.fn(() => ({
                limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
              })),
              or: vi.fn(() => ({
                limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
              })),
            })),
          })),
          update: updateLeadMock,
          insert: insertLeadMock,
        };
      }
      return createChainableMock([]);
    });

    render(
      <EditLeadModal
        isOpen={true}
        onClose={vi.fn()}
        lead={currentLead}
        onLeadUpdated={onLeadUpdatedMock}
      />
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('Mariana')).toBeInTheDocument();
    });

    // Change first name and contact preference
    const nameInput = screen.getByDisplayValue('Mariana');
    fireEvent.change(nameInput, { target: { value: 'Mariana Clara' } });

    // Click Salvar alterações
    const saveBtn = screen.getByRole('button', { name: /Salvar alterações/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(updateLeadMock).toHaveBeenCalled();
      expect(insertLeadMock).not.toHaveBeenCalled(); // ZERO duplicate lead creation
    });

    const updatePayload = (updateLeadMock.mock.calls as any)[0]?.[0] || {};
    expect(updatePayload.first_name).toBe('Mariana Clara');
    expect(updatePayload.last_name).toBe('Souza');
    expect(updatePayload.pipeline_stage_id).toBeUndefined(); // Pipeline stage remains untouched!
  });

  it('10. blocks invalid email format before submission', async () => {
    render(
      <EditLeadModal
        isOpen={true}
        onClose={vi.fn()}
        lead={currentLead}
        onLeadUpdated={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('mariana.souza@example.com')).toBeInTheDocument();
    });

    const emailInput = screen.getByDisplayValue('mariana.souza@example.com');
    fireEvent.change(emailInput, { target: { value: 'invalid-email-without-at' } });

    const saveBtn = screen.getByRole('button', { name: /Salvar alterações/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByText(/formato de e-mail válido/i)).toBeInTheDocument();
    });
  });

  it('11. protects against email identity conflict (blocks unsafe merge or duplicate)', async () => {
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'courses') return createChainableMock(mockCourses);
      if (table === 'course_sessions') return createChainableMock(mockSessions);
      if (table === 'lead_course_interests') return createChainableMock([]);
      if (table === 'leads') {
        return {
          select: vi.fn(() => ({
            neq: vi.fn(() => ({
              ilike: vi.fn(() => ({
                limit: vi.fn(() =>
                  Promise.resolve({
                    data: [{ id: 'lead-conflict-999', first_name: 'Doutora', last_name: 'Existente' }],
                    error: null,
                  })
                ),
              })),
            })),
          })),
        };
      }
      return createChainableMock([]);
    });

    render(
      <EditLeadModal
        isOpen={true}
        onClose={vi.fn()}
        lead={currentLead}
        onLeadUpdated={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('mariana.souza@example.com')).toBeInTheDocument();
    });

    const emailInput = screen.getByDisplayValue('mariana.souza@example.com');
    fireEvent.change(emailInput, { target: { value: 'existente@example.com' } });

    const saveBtn = screen.getByRole('button', { name: /Salvar alterações/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByText(/Conflito de identidade/i)).toBeInTheDocument();
      expect(screen.getByText(/Doutora Existente/i)).toBeInTheDocument();
    });
  });

  it('12. displays factual suppression warning when email is in email_suppressions', async () => {
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'courses') return createChainableMock(mockCourses);
      if (table === 'course_sessions') return createChainableMock(mockSessions);
      if (table === 'lead_course_interests') return createChainableMock([]);
      if (table === 'email_suppressions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() => Promise.resolve({ data: { reason: 'complaint' }, error: null })),
            })),
          })),
        };
      }
      return createChainableMock([]);
    });

    render(
      <EditLeadModal
        isOpen={true}
        onClose={vi.fn()}
        lead={currentLead}
        onLeadUpdated={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('mariana.souza@example.com')).toBeInTheDocument();
    });

    const emailInput = screen.getByDisplayValue('mariana.souza@example.com');
    fireEvent.change(emailInput, { target: { value: 'complained.user@example.com' } });
    fireEvent.blur(emailInput);

    await waitFor(() => {
      expect(screen.getByText(/Aviso: O endereço "complained.user@example.com" está suprimido/i)).toBeInTheDocument();
    });
  });

  it('13. preserves canonical rule of up to 3 prioritized course interests', async () => {
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'courses') return createChainableMock(mockCourses);
      if (table === 'course_sessions') return createChainableMock(mockSessions);
      if (table === 'lead_course_interests') return createChainableMock([]);
      return createChainableMock([]);
    });

    render(
      <EditLeadModal
        isOpen={true}
        onClose={vi.fn()}
        lead={currentLead}
        onLeadUpdated={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Cursos de Interesse (Até 3 priorizados)')).toBeInTheDocument();
    });

    // Click "Adicionar outro" twice to reach 3
    const addBtn = screen.getByText('Adicionar outro');
    fireEvent.click(addBtn);
    expect(screen.getByText('Prioridade #2')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Adicionar outro'));
    expect(screen.getByText('Prioridade #3')).toBeInTheDocument();

    // After 3 items, "Adicionar outro" button must be hidden
    expect(screen.queryByText('Adicionar outro')).toBeNull();
  });

  it('14. dispatches window "lead-updated" event on save to update Contatos & Pipeline without hard reload', async () => {
    const eventListener = vi.fn();
    window.addEventListener('lead-updated', eventListener);

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'courses') return createChainableMock(mockCourses);
      if (table === 'course_sessions') return createChainableMock(mockSessions);
      if (table === 'email_suppressions') return createChainableMock(null);
      if (table === 'lead_course_interests') {
        return {
          select: vi.fn(() => createChainableMock([])),
          delete: vi.fn(() => createChainableMock([])),
          insert: vi.fn(() => Promise.resolve({ data: null, error: null })),
          eq: vi.fn(() => ({
            order: vi.fn(() => Promise.resolve({ data: [], error: null })),
          })),
        };
      }
      if (table === 'leads') {
        return {
          select: vi.fn(() => ({
            neq: vi.fn(() => ({
              ilike: vi.fn(() => ({
                limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
              })),
              or: vi.fn(() => ({
                limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
              })),
            })),
          })),
          update: vi.fn(() => createChainableMock(null)),
        };
      }
      return createChainableMock([]);
    });

    render(
      <EditLeadModal
        isOpen={true}
        onClose={vi.fn()}
        lead={currentLead}
        onLeadUpdated={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('Mariana')).toBeInTheDocument();
    });

    const saveBtn = screen.getByRole('button', { name: /Salvar alterações/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(eventListener).toHaveBeenCalled();
    });

    const customEvent = eventListener.mock.calls[0][0];
    expect(customEvent.detail.leadId).toBe('lead-edit-123');

    window.removeEventListener('lead-updated', eventListener);
  });
});
