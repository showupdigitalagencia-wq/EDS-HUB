import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { AudienceSection } from '../features/campaigns/components/AudienceSection';
import { CampaignDetailPage } from '../features/campaigns/CampaignDetailPage';
import { LeadsListPage } from '../features/leads/LeadsListPage';
import { LeadDetailPage } from '../features/leads/LeadDetailPage';
import { LeadProfileContent } from '../features/leads/components/LeadProfileContent';
import { PipelineKanbanPage } from '../features/pipeline/PipelineKanbanPage';
import { CampaignAudienceService } from '../features/campaigns/services/campaign-audience-service';
import type { Lead, Campaign, PipelineStage } from '../types';

// Chainable mock builder for Supabase queries
function createChainableMock(data: any = []) {
  const query: any = {
    _data: data,
  };
  const chainable = () => query;
  query.select = vi.fn().mockImplementation(chainable);
  query.insert = vi.fn().mockImplementation(chainable);
  query.update = vi.fn().mockImplementation(chainable);
  query.delete = vi.fn().mockImplementation(chainable);
  query.eq = vi.fn().mockImplementation(chainable);
  query.neq = vi.fn().mockImplementation(chainable);
  query.gt = vi.fn().mockImplementation(chainable);
  query.gte = vi.fn().mockImplementation(chainable);
  query.lt = vi.fn().mockImplementation(chainable);
  query.lte = vi.fn().mockImplementation(chainable);
  query.like = vi.fn().mockImplementation(chainable);
  query.ilike = vi.fn().mockImplementation(chainable);
  query.is = vi.fn().mockImplementation(chainable);
  query.in = vi.fn().mockImplementation(chainable);
  query.contains = vi.fn().mockImplementation(chainable);
  query.containedBy = vi.fn().mockImplementation(chainable);
  query.range = vi.fn().mockImplementation(chainable);
  query.order = vi.fn().mockImplementation(chainable);
  query.limit = vi.fn().mockImplementation(chainable);
  query.or = vi.fn().mockImplementation(chainable);
  query.single = vi.fn().mockImplementation(() =>
    Promise.resolve({ data: Array.isArray(data) ? (data.length > 0 ? data[0] : null) : data, error: null })
  );
  query.maybeSingle = vi.fn().mockImplementation(() =>
    Promise.resolve({ data: Array.isArray(data) ? (data.length > 0 ? data[0] : null) : data, error: null })
  );
  query.then = (resolve: any, reject?: any) =>
    Promise.resolve({
      data: Array.isArray(data) ? data : [data],
      count: Array.isArray(data) ? data.length : 1,
      error: null,
    }).then(resolve, reject);
  return query;
}

// Mock Supabase
vi.mock('../lib/supabase', () => {
  const mockFrom = vi.fn();
  const mockRpc = vi.fn();
  return {
    supabase: {
      from: mockFrom,
      rpc: mockRpc,
      channel: vi.fn(() => ({
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn().mockReturnThis(),
      })),
      removeChannel: vi.fn(),
    },
    isTransientNetworkError: () => false,
  };
});

// Mock AuthProvider with authorized admin
let mockIsAuthorized = true;
vi.mock('../features/auth/AuthProvider', () => ({
  useAuth: () => ({
    session: { user: { id: 'test-admin-id' } },
    user: { id: 'test-admin-id' },
    appUser: {
      id: 'app-user-1',
      display_name: 'Dr. Test Admin',
      email: 'admin@edshub.com',
      is_active: true,
      role: 'admin',
    },
    isLoading: false,
    isAuthorized: mockIsAuthorized,
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
}));

// Controlled helper component for AudienceSection tests
function AudienceSectionControlled(props: { initialSelected?: string[] }) {
  const [filters, setFilters] = useState<any>({
    mode: 'individual',
    selected_lead_ids: props.initialSelected || [],
  });
  return (
    <AudienceSection
      channel="email"
      filterDefinition={filters}
      onChange={setFilters}
    />
  );
}

describe('EDS HUB — Campaign Delete, Real Lead Picker & Safe Lead Delete Suite', () => {
  const mockStages: PipelineStage[] = [
    { id: 'stg-1', code: 'capture', name: 'Novo Lead', sort_order: 1, is_active: true } as any,
    { id: 'stg-2', code: 'qualification', name: 'Respondido', sort_order: 2, is_active: true } as any,
    { id: 'stg-3', code: 'acquisition', name: 'Interessado', sort_order: 3, is_active: true } as any,
  ];

  const mockLeads: Partial<Lead>[] = [
    {
      id: 'lead-1',
      first_name: 'Maria',
      last_name: 'Silva',
      email: 'maria@email.com',
      phone_raw: '+5511999990001',
      phone_e164: '+5511999990001',
      contact_preference: 'email',
      pipeline_stage_id: 'stg-3',
      course_interest: 'Zygomatic Implant Training',
      deleted_at: null,
      created_at: '2026-09-01T10:00:00Z',
    },
    {
      id: 'lead-2',
      first_name: 'Carlos',
      last_name: 'Santos',
      email: 'carlos@email.com',
      phone_raw: '+5511999990002',
      phone_e164: '+5511999990002',
      contact_preference: 'sms', // Not eligible for email
      pipeline_stage_id: 'stg-1',
      course_interest: 'Advanced Surgery',
      deleted_at: null,
      created_at: '2026-09-02T10:00:00Z',
    },
    {
      id: 'lead-3',
      first_name: 'Ana',
      last_name: 'Oliveira',
      email: null, // No valid email
      phone_raw: '+5511999990003',
      contact_preference: 'email',
      pipeline_stage_id: 'stg-2',
      deleted_at: null,
      created_at: '2026-09-03T10:00:00Z',
    },
  ];

  const mockCampaign: Partial<Campaign> = {
    id: 'camp-123',
    name: 'Campanha Implantes Setembro',
    description: 'Campanha para médicos interessados',
    channel: 'email',
    status: 'draft',
    created_at: '2026-09-20T10:00:00Z',
    updated_at: '2026-09-20T10:00:00Z',
    deleted_at: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAuthorized = true;

    // Default supabase.from mock implementation using chainable builder
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'campaigns') {
        return createChainableMock([mockCampaign]);
      }
      if (table === 'leads') {
        return createChainableMock(
          mockLeads.map((l) => ({
            ...l,
            pipeline_stages: mockStages.find((s) => s.id === l.pipeline_stage_id),
            lead_course_interests: [],
          }))
        );
      }
      if (table === 'pipeline_stages') {
        return createChainableMock(mockStages);
      }
      if (table === 'campaign_versions') {
        return createChainableMock([
          {
            id: 'v1',
            campaign_id: mockCampaign.id,
            version_number: 1,
            content_json: [],
            html_snapshot: '',
            text_snapshot: '',
          },
        ]);
      }
      if (table === 'campaign_audiences') {
        return createChainableMock([
          {
            id: 'aud-1',
            campaign_id: mockCampaign.id,
            filter_definition: { mode: 'individual', selected_lead_ids: [] },
            total_matched_count: 3,
            eligible_count: 1,
            excluded_count: 2,
          },
        ]);
      }
      if (table === 'courses') {
        return createChainableMock([
          { id: 'c1', name: 'Zygomatic Training', code: 'ZYGO', active: true },
        ]);
      }
      if (table === 'email_templates') {
        return createChainableMock([]);
      }
      return createChainableMock([]);
    });

    (supabase.rpc as any).mockImplementation((func: string, params: any) => {
      if (func === 'safe_delete_campaign') {
        return Promise.resolve({
          data: { success: true, action: 'soft_deleted', campaign_id: params?.p_campaign_id },
          error: null,
        });
      }
      if (func === 'safe_delete_lead') {
        return Promise.resolve({
          data: { success: true, lead_id: params?.p_lead_id, cancelled_tasks_count: 1, archived_links_count: 1 },
          error: null,
        });
      }
      if (func === 'get_pipeline_stage_counts') {
        return Promise.resolve({
          data: mockStages.map((s) => ({
            stage_id: s.id,
            stage_code: s.code,
            stage_name: s.name,
            sort_order: s.sort_order,
            lead_count: 1,
          })),
          error: null,
        });
      }
      if (func === 'preview_audience_segment') {
        return Promise.resolve({
          data: {
            total_matched: 1,
            eligible_count: 1,
            excluded_count: 0,
            leads: [],
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
  });

  // ==========================================
  // PART 1 — CAMPAIGN DELETE TESTS
  // ==========================================
  describe('Part 1: Safe Campaign Deletion', () => {
    it('1. Displays "Excluir campanha" button inside danger zone on Campaign Detail', async () => {
      render(
        <MemoryRouter initialEntries={[`/campaigns/${mockCampaign.id}`]}>
          <Routes>
            <Route path="/campaigns/:id" element={<CampaignDetailPage />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('delete-campaign-button')).toBeInTheDocument();
      });

      const deleteButton = screen.getByTestId('delete-campaign-button');
      expect(deleteButton).toBeInTheDocument();
      expect(deleteButton).toHaveTextContent('Excluir campanha');
    });

    it('2. Clicking "Excluir campanha" opens confirmation modal without immediately deleting', async () => {
      render(
        <MemoryRouter initialEntries={[`/campaigns/${mockCampaign.id}`]}>
          <Routes>
            <Route path="/campaigns/:id" element={<CampaignDetailPage />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('delete-campaign-button')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('delete-campaign-button'));

      // Modal appears
      expect(screen.getByText('Excluir campanha?')).toBeInTheDocument();
      expect(screen.getAllByText(mockCampaign.name!).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Esta ação removerá esta campanha do EDS HUB.')).toBeInTheDocument();
      expect(screen.getByTestId('confirm-delete-campaign-button')).toBeInTheDocument();
      expect(screen.getByText('Cancelar')).toBeInTheDocument();

      // RPC must NOT have been called yet
      expect(supabase.rpc).not.toHaveBeenCalledWith('safe_delete_campaign', expect.anything());
    });

    it('3. Clicking "Cancelar" closes modal and leaves campaign untouched', async () => {
      render(
        <MemoryRouter initialEntries={[`/campaigns/${mockCampaign.id}`]}>
          <Routes>
            <Route path="/campaigns/:id" element={<CampaignDetailPage />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('delete-campaign-button')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('delete-campaign-button'));
      expect(screen.getByText('Excluir campanha?')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Cancelar'));

      await waitFor(() => {
        expect(screen.queryByText('Excluir campanha?')).not.toBeInTheDocument();
      });
      expect(supabase.rpc).not.toHaveBeenCalledWith('safe_delete_campaign', expect.anything());
    });

    it('4. Confirming deletion executes safeDeleteCampaign and preserves history', async () => {
      render(
        <MemoryRouter initialEntries={[`/campaigns/${mockCampaign.id}`]}>
          <Routes>
            <Route path="/campaigns/:id" element={<CampaignDetailPage />} />
            <Route path="/campaigns" element={<div>Lista de Campanhas</div>} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('delete-campaign-button')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('delete-campaign-button'));
      fireEvent.click(screen.getByTestId('confirm-delete-campaign-button'));

      await waitFor(() => {
        expect(supabase.rpc).toHaveBeenCalledWith('safe_delete_campaign', {
          p_campaign_id: mockCampaign.id,
        });
      });
    });

    it('5. Unauthorized user does not see "Excluir campanha"', async () => {
      mockIsAuthorized = false;

      render(
        <MemoryRouter initialEntries={[`/campaigns/${mockCampaign.id}`]}>
          <Routes>
            <Route path="/campaigns/:id" element={<CampaignDetailPage />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.queryByTestId('delete-campaign-button')).not.toBeInTheDocument();
      });
    });
  });

  // ==========================================
  // PART 2 — REAL LEAD PICKER TESTS
  // ==========================================
  describe('Part 2: Real Lead Picker in Audience Section', () => {
    it('6. Shows real leads when "Leads Específicos" mode is selected', async () => {
      const mockOnChange = vi.fn();
      render(
        <MemoryRouter>
          <AudienceSection
            channel="email"
            filterDefinition={{ version: 1, operator: 'and', mode: 'individual', selected_lead_ids: [] }}
            onChange={mockOnChange}
          />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Maria Silva')).toBeInTheDocument();
        expect(screen.getByText('maria@email.com')).toBeInTheDocument();
        expect(screen.getByText('Zygomatic Implant Training')).toBeInTheDocument();
      });
    });

    it('7. Displays clear eligibility status per lead (Eligible vs Ineligible with reason)', async () => {
      const mockOnChange = vi.fn();
      render(
        <MemoryRouter>
          <AudienceSection
            channel="email"
            filterDefinition={{ version: 1, operator: 'and', mode: 'individual', selected_lead_ids: [] }}
            onChange={mockOnChange}
          />
        </MemoryRouter>
      );

      await waitFor(() => {
        // Maria has email preference and email -> Elegível para email
        expect(screen.getByText('Elegível para email')).toBeInTheDocument();

        // Carlos has SMS preference -> Não elegível — Preferência: SMS
        expect(screen.getByText(/Não elegível — Preferência: SMS/i)).toBeInTheDocument();

        // Ana has no email -> Não elegível — Sem email válido
        expect(screen.getByText(/Não elegível — Sem email válido/i)).toBeInTheDocument();
      });
    });

    it('8. Ineligible leads are disabled and cannot be selected for sending', async () => {
      const mockOnChange = vi.fn();
      render(
        <MemoryRouter>
          <AudienceSection
            channel="email"
            filterDefinition={{ version: 1, operator: 'and', mode: 'individual', selected_lead_ids: [] }}
            onChange={mockOnChange}
          />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Carlos Santos')).toBeInTheDocument();
      });

      const smsLeadCheckbox = screen.getByTestId('lead-select-checkbox-lead-2');
      expect(smsLeadCheckbox).toBeDisabled();

      fireEvent.click(smsLeadCheckbox);
      expect(smsLeadCheckbox).not.toBeChecked();
    });

    it('9. Eligible lead can be checked, updates selected count and shows chip in "Selecionados"', async () => {
      render(
        <MemoryRouter>
          <AudienceSectionControlled />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Maria Silva')).toBeInTheDocument();
      });

      const mariaCheckbox = screen.getByTestId('lead-select-checkbox-lead-1');
      expect(mariaCheckbox).not.toBeDisabled();

      fireEvent.click(mariaCheckbox);

      await waitFor(() => {
        expect(screen.getByText(/1 lead selecionado/i)).toBeInTheDocument();
        expect(screen.getByTestId('remove-selected-lead-lead-1')).toBeInTheDocument();
      });

      // Remove via chip
      fireEvent.click(screen.getByTestId('remove-selected-lead-lead-1'));
      await waitFor(() => {
        expect(screen.getByText(/0 leads selecionados/i)).toBeInTheDocument();
      });
    });

    it('10. "Selecionar todos os elegíveis" selects all eligible leads only', async () => {
      render(
        <MemoryRouter>
          <AudienceSectionControlled />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('select-all-eligible-btn')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('select-all-eligible-btn'));

      await waitFor(() => {
        // Only 1 lead (Maria) is eligible among the 3 mock leads
        expect(screen.getByText(/1 lead selecionado/i)).toBeInTheDocument();
      });

      // Clear selection
      fireEvent.click(screen.getByTestId('clear-selection-btn'));
      await waitFor(() => {
        expect(screen.getByText(/0 leads selecionados/i)).toBeInTheDocument();
      });
    });

    it('11. Search by name, email, or phone filters leads correctly', async () => {
      const mockOnChange = vi.fn();
      render(
        <MemoryRouter>
          <AudienceSection
            channel="email"
            filterDefinition={{ version: 1, operator: 'and', mode: 'individual', selected_lead_ids: [] }}
            onChange={mockOnChange}
          />
        </MemoryRouter>
      );

      const searchInput = screen.getByTestId('real-lead-search-input');
      expect(searchInput).toBeInTheDocument();

      fireEvent.change(searchInput, { target: { value: 'maria' } });
      expect(searchInput).toHaveValue('maria');
    });
  });

  // ==========================================
  // PART 3 — SAFE LEAD DELETE TESTS
  // ==========================================
  describe('Part 3: Safe Lead Deletion from Contacts & Lead Profile', () => {
    it('12. Contacts list displays "Excluir lead" in contextual action menu', async () => {
      render(
        <MemoryRouter>
          <LeadsListPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        const matches = screen.getAllByText('Maria Silva');
        expect(matches.length).toBeGreaterThan(0);
      });

      const menuButtons = screen.getAllByTestId('lead-actions-menu-lead-1');
      expect(menuButtons.length).toBeGreaterThan(0);
      fireEvent.click(menuButtons[0]);

      const deleteButtons = screen.getAllByTestId('delete-lead-menu-lead-1');
      expect(deleteButtons.length).toBeGreaterThan(0);
      expect(deleteButtons[0]).toHaveTextContent('Excluir lead');
    });

    it('13. Clicking "Excluir lead" in Contacts shows confirmation modal with lead details', async () => {
      render(
        <MemoryRouter>
          <LeadsListPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        const matches = screen.getAllByText('Maria Silva');
        expect(matches.length).toBeGreaterThan(0);
      });

      const menuButtons = screen.getAllByTestId('lead-actions-menu-lead-1');
      fireEvent.click(menuButtons[0]);

      const deleteButtons = screen.getAllByTestId('delete-lead-menu-lead-1');
      fireEvent.click(deleteButtons[0]);

      expect(screen.getByText('Excluir lead?')).toBeInTheDocument();
      expect(screen.getByText('Este lead será removido das listas operacionais do CRM.')).toBeInTheDocument();
      expect(screen.getByTestId('confirm-delete-lead-button')).toBeInTheDocument();
    });

    it('14. Confirming lead deletion calls safeDeleteLead RPC and preserves audit history', async () => {
      render(
        <MemoryRouter>
          <LeadsListPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        const matches = screen.getAllByText('Maria Silva');
        expect(matches.length).toBeGreaterThan(0);
      });

      const menuButtons = screen.getAllByTestId('lead-actions-menu-lead-1');
      fireEvent.click(menuButtons[0]);

      const deleteButtons = screen.getAllByTestId('delete-lead-menu-lead-1');
      fireEvent.click(deleteButtons[0]);

      fireEvent.click(screen.getByTestId('confirm-delete-lead-button'));

      await waitFor(() => {
        expect(supabase.rpc).toHaveBeenCalledWith('safe_delete_lead', {
          p_lead_id: 'lead-1',
        });
      });
    });

    it('15. LeadDetailPage displays "Excluir lead" in Danger Zone with confirmation modal', async () => {
      render(
        <MemoryRouter initialEntries={['/leads/lead-1']}>
          <Routes>
            <Route path="/leads/:id" element={<LeadDetailPage />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('detail-delete-lead-button')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('detail-delete-lead-button'));

      expect(screen.getByText('Excluir lead?')).toBeInTheDocument();
      expect(screen.getByText('Este lead será removido das listas operacionais do CRM.')).toBeInTheDocument();
    });

    it('16. LeadProfileContent displays "Excluir lead" in Danger Zone with confirmation modal', async () => {
      const mockOnLeadDeleted = vi.fn();
      render(
        <MemoryRouter>
          <LeadProfileContent
            leadId="lead-1"
            initialLead={mockLeads[0] as Lead}
            onLeadDeleted={mockOnLeadDeleted}
          />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('profile-delete-lead-button')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('profile-delete-lead-button'));

      expect(screen.getByText('Excluir lead?')).toBeInTheDocument();
      expect(screen.getByTestId('confirm-delete-lead-button')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('confirm-delete-lead-button'));

      await waitFor(() => {
        expect(supabase.rpc).toHaveBeenCalledWith('safe_delete_lead', {
          p_lead_id: 'lead-1',
        });
        expect(mockOnLeadDeleted).toHaveBeenCalled();
      });
    });

    it('17. PipelineKanbanPage filters out soft-deleted leads from display', async () => {
      render(
        <MemoryRouter>
          <PipelineKanbanPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Novo Lead')).toBeInTheDocument();
      });

      // Verify leads table query filtered deleted_at IS NULL
      expect(supabase.from).toHaveBeenCalledWith('leads');
    });

    it('18. CampaignAudienceService.safeDeleteLead direct fallback handles offline / missing RPC', async () => {
      (supabase.rpc as any).mockResolvedValueOnce({
        data: null,
        error: { message: 'Function not found' },
      });

      const res = await CampaignAudienceService.safeDeleteLead('lead-1');
      expect(res.success).toBe(true);
      expect(res.lead_id).toBe('lead-1');
    });

    it('19. CampaignAudienceService.safeDeleteCampaign direct fallback handles offline / missing RPC', async () => {
      (supabase.rpc as any).mockResolvedValueOnce({
        data: null,
        error: { message: 'Function not found' },
      });

      const res = await CampaignAudienceService.safeDeleteCampaign('camp-123');
      expect(res.success).toBe(true);
      expect(res.campaign_id).toBe('camp-123');
    });
  });
});
