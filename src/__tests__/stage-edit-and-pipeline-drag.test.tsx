import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { LeadProfileContent } from '../features/leads/components/LeadProfileContent';
import { ChangeLeadStageModal, CANONICAL_OPERATIONAL_STAGE_CODES } from '../features/leads/components/ChangeLeadStageModal';
import { MinimalLeadCard } from '../features/pipeline/components/MinimalLeadCard';
import { PipelineKanbanPage } from '../features/pipeline/PipelineKanbanPage';
import type { Lead, PipelineStage } from '../types';

// Mock Supabase
vi.mock('../lib/supabase', () => {
  const mockFrom = vi.fn();
  const mockRpc = vi.fn();
  return {
    supabase: {
      from: mockFrom,
      rpc: mockRpc,
    },
  };
});

// Mock AuthProvider
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

describe('EDS HUB — Stage Edit + Pipeline Drag & Drop Suite', () => {
  const mockStages: PipelineStage[] = [
    { id: 's1', code: 'capture', name: 'Novo Lead', sort_order: 1, is_active: true } as any,
    { id: 's2', code: 'qualification', name: 'Respondido', sort_order: 2, is_active: true } as any,
    { id: 's3', code: 'acquisition', name: 'Interessado', sort_order: 3, is_active: true } as any,
    { id: 's4', code: 'approval', name: 'Quente', sort_order: 4, is_active: true } as any,
    { id: 's5', code: 'enrollment', name: 'Matrícula', sort_order: 5, is_active: true } as any,
    { id: 's6', code: 'post_course', name: 'Pós-Curso', sort_order: 6, is_active: true } as any,
    { id: 's7', code: 'alumni', name: 'Alumni', sort_order: 7, is_active: true } as any,
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'pipeline_stages') {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockImplementation((_col: string, allowedCodes: string[]) => ({
            order: vi.fn().mockResolvedValue({
              data: mockStages.filter((s) => allowedCodes.includes(s.code)),
              error: null,
            }),
          })),
          order: vi.fn().mockResolvedValue({
            data: mockStages.filter((s) => CANONICAL_OPERATIONAL_STAGE_CODES.includes(s.code as any)),
            error: null,
          }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
      };
    });
  });

  const mockLead: Lead = {
    id: 'lead-123',
    first_name: 'Dra. Camila',
    last_name: 'Ferreira',
    email: 'camila@dentista.com',
    phone_raw: '+55 11 98888-7777',
    phone_e164: '+5511988887777',
    contact_preference: 'email',
    pipeline_stage_id: 's3',
    pipeline_stage: { id: 's3', name: 'Interessado', code: 'acquisition' } as any,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as unknown as Lead;

  // ===========================================================================
  // 1. LEAD PROFILE — CURRENT STAGE & "ALTERAR ETAPA"
  // ===========================================================================
  describe('1. Lead Profile Stage Visibility and Manual Edit', () => {
    it('shows the current pipeline stage clearly inside Complete Lead Profile', () => {
      // Mock supabase.from queries for LeadProfileContent
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'leads') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: mockLead, error: null }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      });

      render(
        <MemoryRouter>
          <LeadProfileContent leadId="lead-123" initialLead={mockLead} />
        </MemoryRouter>
      );

      // Verify "Etapa atual:" label is present
      expect(screen.getByText('Etapa atual:')).toBeDefined();

      // Verify current stage name "Interessado" is displayed
      const stageNameEl = screen.getByTestId('profile-current-stage-name');
      expect(stageNameEl).toHaveTextContent('Interessado');

      // Verify "Alterar etapa" action button is visible
      const changeStageBtn = screen.getByTestId('alterar-etapa-button');
      expect(changeStageBtn).toBeDefined();
      expect(changeStageBtn).toHaveTextContent('Alterar etapa');
    });

    it('clicking "Alterar etapa" opens the internal selector modal', async () => {
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'pipeline_stages') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: mockStages.filter((s) => CANONICAL_OPERATIONAL_STAGE_CODES.includes(s.code as any)),
              error: null,
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      });

      render(
        <MemoryRouter>
          <LeadProfileContent leadId="lead-123" initialLead={mockLead} />
        </MemoryRouter>
      );

      const changeStageBtn = screen.getByTestId('alterar-etapa-button');
      fireEvent.click(changeStageBtn);

      // Verify modal opens with Title and Current Stage
      await waitFor(() => {
        expect(screen.getByText('Nova etapa:')).toBeDefined();
        expect(screen.getByTestId('modal-current-stage-name')).toHaveTextContent('Interessado');
      });
    });
  });

  // ===========================================================================
  // 2. CANONICAL 5 STAGES & EXCLUSION OF POST_COURSE / ALUMNI
  // ===========================================================================
  describe('2. Canonical Stages Filtering', () => {
    it('ChangeLeadStageModal presents ONLY canonical 5 stages and excludes post_course and alumni', async () => {
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'pipeline_stages') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockImplementation((_col: string, allowedCodes: string[]) => {
              const filtered = mockStages.filter((s) => allowedCodes.includes(s.code));
              return {
                order: vi.fn().mockResolvedValue({ data: filtered, error: null }),
              };
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      });

      render(
        <MemoryRouter>
          <ChangeLeadStageModal
            isOpen={true}
            onClose={vi.fn()}
            leadId="lead-123"
            leadName="Dra. Camila Ferreira"
            currentStageId="s3"
            currentStageName="Interessado"
            onStageUpdated={vi.fn()}
          />
        </MemoryRouter>
      );

      await waitFor(() => {
        // Canonical 5 stages present
        expect(screen.getByTestId('stage-option-capture')).toHaveTextContent('Novo Lead');
        expect(screen.getByTestId('stage-option-qualification')).toHaveTextContent('Respondido');
        expect(screen.getByTestId('stage-option-acquisition')).toHaveTextContent('Interessado');
        expect(screen.getByTestId('stage-option-approval')).toHaveTextContent('Quente');
        expect(screen.getByTestId('stage-option-enrollment')).toHaveTextContent('Matrícula');
      });

      // Post-Course and Alumni strictly EXCLUDED
      expect(screen.queryByTestId('stage-option-post_course')).toBeNull();
      expect(screen.queryByTestId('stage-option-alumni')).toBeNull();
      expect(screen.queryByText('Pós-Curso')).toBeNull();
      expect(screen.queryByText('Alumni')).toBeNull();
    });
  });

  // ===========================================================================
  // 3. ATOMIC PERSISTENCE & HISTORY
  // ===========================================================================
  describe('3. Stage Movement Persistence & Atomic RPC', () => {
    it('calls move_lead_stage RPC, dispatches lead-updated event, and shows "Etapa atualizada"', async () => {
      (supabase.rpc as any).mockResolvedValue({ data: { success: true }, error: null });

      const onStageUpdated = vi.fn();
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

      render(
        <MemoryRouter>
          <ChangeLeadStageModal
            isOpen={true}
            onClose={vi.fn()}
            leadId="lead-123"
            leadName="Dra. Camila Ferreira"
            currentStageId="s3"
            currentStageName="Interessado"
            onStageUpdated={onStageUpdated}
          />
        </MemoryRouter>
      );

      // Select "Quente" (approval stage, s4)
      const quenteBtn = await screen.findByTestId('stage-option-approval');
      fireEvent.click(quenteBtn);

      // Click "Salvar etapa"
      const saveBtn = screen.getByRole('button', { name: /Salvar etapa/i });
      expect(saveBtn).not.toBeDisabled();
      fireEvent.click(saveBtn);

      await waitFor(() => {
        // Verify atomic RPC was called
        expect(supabase.rpc).toHaveBeenCalledWith(
          'move_lead_stage',
          expect.objectContaining({
            p_lead_id: 'lead-123',
            p_new_stage_id: 's4',
          })
        );
        // Verify success alert
        expect(screen.getByTestId('stage-update-success')).toHaveTextContent('Etapa atualizada');
        // Verify callback and global dispatch
        expect(onStageUpdated).toHaveBeenCalledWith('s4', 'Quente');
        expect(dispatchSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'lead-updated',
          })
        );
      });
    });

    it('shows error banner "Não foi possível atualizar a etapa." when move_lead_stage fails', async () => {
      (supabase.rpc as any).mockResolvedValue({ data: null, error: { message: 'Network error' } });

      render(
        <MemoryRouter>
          <ChangeLeadStageModal
            isOpen={true}
            onClose={vi.fn()}
            leadId="lead-123"
            leadName="Dra. Camila Ferreira"
            currentStageId="s3"
            currentStageName="Interessado"
            onStageUpdated={vi.fn()}
          />
        </MemoryRouter>
      );

      // Select "Matrícula" (s5)
      const matriculaBtn = await screen.findByTestId('stage-option-enrollment');
      fireEvent.click(matriculaBtn);

      const saveBtn = screen.getByRole('button', { name: /Salvar etapa/i });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(screen.getByTestId('stage-update-error')).toHaveTextContent(
          'Não foi possível atualizar a etapa.'
        );
      });
    });
  });

  // ===========================================================================
  // 4. PIPELINE DRAG AND DROP & CLICK ISOLATION
  // ===========================================================================
  describe('4. Pipeline Drag-and-Drop and Click Isolation', () => {
    it('lead cards have draggable attribute and dragstart sets dataTransfer', () => {
      const onDragStart = vi.fn();
      const onClick = vi.fn();

      render(
        <MinimalLeadCard
          lead={mockLead}
          stageCode="acquisition"
          stageName="Interessado"
          onDragStart={onDragStart}
          onClick={onClick}
        />
      );

      const card = screen.getByRole('article');
      expect(card.getAttribute('draggable')).toBe('true');

      // Create synthetic DragEvent with mock dataTransfer
      const mockDataTransfer = {
        setData: vi.fn(),
        effectAllowed: '',
      };

      fireEvent.dragStart(card, { dataTransfer: mockDataTransfer });
      expect(onDragStart).toHaveBeenCalledTimes(1);
      expect(mockDataTransfer.setData).toHaveBeenCalledWith('text/plain', 'lead-123');
    });

    it('normal click opens profile when no movement occurs', () => {
      const onClick = vi.fn();

      render(
        <MinimalLeadCard
          lead={mockLead}
          stageCode="acquisition"
          stageName="Interessado"
          onClick={onClick}
        />
      );

      const card = screen.getByRole('article');
      fireEvent.click(card);

      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('pointer movement over threshold suppresses click (prevents accidental drawer opening during drag)', () => {
      const onClick = vi.fn();

      render(
        <MinimalLeadCard
          lead={mockLead}
          stageCode="acquisition"
          stageName="Interessado"
          onClick={onClick}
        />
      );

      const card = screen.getByRole('article');

      // Simulate pointer down, movement of 20px, and click
      fireEvent.pointerDown(card, { clientX: 100, clientY: 100 });
      fireEvent.pointerMove(card, { clientX: 130, clientY: 100 }); // moved 30px > 6px threshold
      fireEvent.click(card);

      // Click should NOT be triggered
      expect(onClick).not.toHaveBeenCalled();
    });

    it('Kanban board drops card, triggers atomic RPC, and handles rollback on failure', async () => {
      // Mock supabase queries for PipelineKanbanPage
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'pipeline_stages') {
          return {
            select: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: mockStages.filter((s) => CANONICAL_OPERATIONAL_STAGE_CODES.includes(s.code as any)),
              error: null,
            }),
          };
        }
        if (table === 'leads') {
          return {
            select: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [mockLead], error: null }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      });

      // Mock move_lead_stage to fail
      (supabase.rpc as any).mockResolvedValue({
        data: null,
        error: { message: 'Database transaction failed' },
      });

      render(
        <MemoryRouter>
          <PipelineKanbanPage />
        </MemoryRouter>
      );

      // Wait for Kanban board to load
      await waitFor(() => {
        expect(screen.getByText('Dra. Camila Ferreira')).toBeDefined();
      });

      // Find the card and start dragging
      const card = screen.getByText('Dra. Camila Ferreira').closest('[role="article"]')!;
      fireEvent.dragStart(card, { dataTransfer: { setData: vi.fn(), effectAllowed: '' } });

      // Find target column "Quente" (approval stage, s4)
      const targetCol = document.getElementById('kanban-col-approval')!;
      expect(targetCol).toBeDefined();

      // Drag over and drop on target column
      fireEvent.dragOver(targetCol, { dataTransfer: { dropEffect: '' } });
      fireEvent.drop(targetCol, { dataTransfer: { getData: () => 'lead-123' } });

      // Verify RPC was attempted
      await waitFor(() => {
        expect(supabase.rpc).toHaveBeenCalledWith(
          'move_lead_stage',
          expect.objectContaining({
            p_lead_id: 'lead-123',
            p_new_stage_id: 's4',
          })
        );
      });

      // Verify rollback & error message
      await waitFor(() => {
        expect(screen.getByTestId('pipeline-stage-error')).toHaveTextContent(
          'Não foi possível atualizar a etapa.'
        );
      });
    });
  });
});
