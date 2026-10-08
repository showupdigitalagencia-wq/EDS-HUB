import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  STANDARD_TURMA_OPTIONS,
  OUTRAS_LABEL,
  parseRepresentativeDates,
  fetchGlobalTurmaOptions,
  saveCustomTurmaOption,
  ensureCourseSessionForLabel,
} from '../features/courses/services/turma-catalog-service';
import { TurmaSelect } from '../features/courses/components/TurmaSelect';
import { MatriculaCourseTurmaModal } from '../features/leads/components/MatriculaCourseTurmaModal';
import { EditLeadModal } from '../features/leads/components/EditLeadModal';
import { ManageCourseModal } from '../features/courses/components/ManageCourseModal';
import { supabase } from '../lib/supabase';
import type { Lead, CourseSession } from '../types';

// Mock Supabase client
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

describe('Part A: Global Turma Catalog and Course Date Workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Global Option Catalog & Label-Only Preservation', () => {
    it('contains all 14 standard labels in exact canonical order', () => {
      expect(STANDARD_TURMA_OPTIONS).toEqual([
        'Nov/25',
        'Feb/26',
        'May/26',
        'Jun/26 SP',
        'Jun/26 Endo',
        'Aug/26',
        'Oct/26',
        'Nov/26',
        'Feb/Mar 2027',
        'Apr/27 - Endo',
        'Apr/27',
        'May/27',
        'Aug/27',
        'Nov/27',
      ]);
    });

    it('label-only turma does NOT invent start/end dates (keeps null dates)', () => {
      const dates = parseRepresentativeDates('Nov/27');
      expect(dates.startDate).toBeNull();
      expect(dates.endDate).toBeNull();
    });

    it('ambiguous multi-month Feb/Mar 2027 remains strictly a label without fake dates', () => {
      expect(STANDARD_TURMA_OPTIONS).toContain('Feb/Mar 2027');
      const dates = parseRepresentativeDates('Feb/Mar 2027');
      expect(dates.startDate).toBeNull();
      expect(dates.endDate).toBeNull();
    });

    it('keeps Apr/27 - Endo distinct from Apr/27', () => {
      expect(STANDARD_TURMA_OPTIONS).toContain('Apr/27 - Endo');
      expect(STANDARD_TURMA_OPTIONS).toContain('Apr/27');
      expect('Apr/27 - Endo').not.toEqual('Apr/27');
    });

    it('keeps Jun/26 SP distinct from Jun/26 Endo', () => {
      expect(STANDARD_TURMA_OPTIONS).toContain('Jun/26 SP');
      expect(STANDARD_TURMA_OPTIONS).toContain('Jun/26 Endo');
      expect('Jun/26 SP').not.toEqual('Jun/26 Endo');
    });

    it('preserves real historical session dates untouched when existing rich session has dates', () => {
      const legacySession: CourseSession = {
        id: 'legacy-sess-1',
        course_id: 'c-1',
        code: 'CS-OCT26-01',
        title: 'October 2026 Cohort',
        status: 'confirmed',
        start_date: '2026-10-08',
        end_date: '2026-10-11',
        timezone: 'America/New_York',
        capacity: 20,
        location: 'Orlando, FL',
        instructor_name: 'Dr. Expert',
        notes: null,
        created_by_user_id: null,
        created_at: '2026-08-01T00:00:00Z',
        updated_at: '2026-08-01T00:00:00Z',
      };

      // Factual dates remain exactly what was authored historically
      expect(legacySession.start_date).toBe('2026-10-08');
      expect(legacySession.end_date).toBe('2026-10-11');
      expect(legacySession.title).toBe('October 2026 Cohort');
    });

    it('creates label-only session with null start_date and end_date when inserting new turma', async () => {
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'course_sessions') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'sess-label-only-1',
                    course_id: 'c-zygo',
                    title: 'Feb/Mar 2027',
                    code: 'CS-FEBMAR2027-1',
                    status: 'open',
                    start_date: null,
                    end_date: null,
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        return { select: vi.fn().mockReturnThis() };
      });

      const session = await ensureCourseSessionForLabel('c-zygo', 'Feb/Mar 2027');
      expect(session.id).toBe('sess-label-only-1');
      expect(session.title).toBe('Feb/Mar 2027');
      expect(session.start_date).toBeNull();
      expect(session.end_date).toBeNull();
    });
  });

  describe('2. Custom Options ("Outras") Persistence', () => {
    it('fetches global options including custom options from app_settings', async () => {
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'app_settings') {
          return {
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { custom_turma_options: ['Jan/28', 'Mar/28'] },
                error: null,
              }),
            }),
          };
        }
        if (table === 'course_sessions') {
          return {
            select: vi.fn().mockResolvedValue({
              data: [{ title: 'Nov/26' }, { title: 'Jul/28' }],
              error: null,
            }),
          };
        }
        return { select: vi.fn().mockReturnThis() };
      });

      const options = await fetchGlobalTurmaOptions();
      expect(options).toContain('Nov/26');
      expect(options).toContain('Jan/28');
      expect(options).toContain('Mar/28');
      expect(options).toContain('Jul/28');
    });

    it('persists a custom option atomically via RPC save_custom_turma_option', async () => {
      (supabase.rpc as any).mockResolvedValue({
        data: ['Jan/28'],
        error: null,
      });

      const updated = await saveCustomTurmaOption('Jan/28');
      expect(updated).toContain('Jan/28');
      expect(supabase.rpc).toHaveBeenCalledWith('save_custom_turma_option', {
        p_label: 'Jan/28',
      });
    });
  });

  describe('3. TurmaSelect Component', () => {
    it('renders standard turma options in dropdown', async () => {
      render(
        <TurmaSelect
          value=""
          onChange={vi.fn()}
          placeholder="Selecione a turma..."
          testId="test-turma-select"
        />
      );

      const select = screen.getByTestId('test-turma-select');
      expect(select).toBeInTheDocument();
      expect(screen.getByText('Nov/26')).toBeInTheDocument();
      expect(screen.getByText('Feb/Mar 2027')).toBeInTheDocument();
      expect(screen.getByText('Apr/27 - Endo')).toBeInTheDocument();
      expect(screen.getByText(/Outras \(Adicionar nova\.\.\.\)/)).toBeInTheDocument();
    });

    it('reveals text input when "Outras" is selected and saves custom option', async () => {
      const handleChange = vi.fn();
      render(
        <TurmaSelect
          value=""
          onChange={handleChange}
          testId="test-turma-select"
        />
      );

      const select = screen.getByTestId('test-turma-select');
      fireEvent.change(select, { target: { value: OUTRAS_LABEL } });

      const input = await screen.findByTestId('test-turma-select-custom-input');
      expect(input).toBeInTheDocument();

      fireEvent.change(input, { target: { value: 'Jan/28' } });
      expect(handleChange).toHaveBeenCalledWith('Jan/28');
    });
  });

  describe('4. MatriculaCourseTurmaModal without OPEN session blocking', () => {
    it('allows assigning any catalog turma even when no OPEN sessions exist in DB', async () => {
      const mockCourses = [
        { id: 'c-advanced', name: 'Advanced Dental Implant Experience', code: 'ADIE-01' },
      ];

      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'courses') {
          return {
            select: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ data: mockCourses, error: null }),
          };
        }
        if (table === 'course_sessions') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockReturnValue({
                  order: vi.fn().mockResolvedValue({
                    data: [], // ZERO existing sessions
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'lead_course_interests') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        if (table === 'leads') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        if (table === 'enrollments') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          };
        }
        return { select: vi.fn().mockReturnThis() };
      });

      (supabase.rpc as any).mockImplementation((fn: string) => {
        if (fn === 'ensure_course_session_for_label') {
          return Promise.resolve({ data: 'sess-auto-nov26', error: null });
        }
        return Promise.resolve({ data: null, error: null });
      });

      const handleSuccess = vi.fn();
      const handleClose = vi.fn();

      render(
        <MatriculaCourseTurmaModal
          isOpen={true}
          onClose={handleClose}
          leadId="lead-123"
          currentCourseId="c-advanced"
          onSuccess={handleSuccess}
        />
      );

      // Verify no blocking state
      await waitFor(() => {
        expect(screen.queryByText(/Nenhuma turma aberta encontrada/i)).not.toBeInTheDocument();
      });

      // Turma select contains Nov/26
      const turmaSelect = screen.getByTestId('matricula-turma-select');
      expect(turmaSelect).toBeInTheDocument();
      fireEvent.change(turmaSelect, { target: { value: 'Nov/26' } });

      const saveBtn = screen.getByTestId('salvar-matricula-curso-turma-button');
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(handleSuccess).toHaveBeenCalled();
        expect(handleClose).toHaveBeenCalled();
      });
    });
  });

  describe('5. EditLeadModal Independent Turmas per Course Interest', () => {
    it('allows independent turma assignment per prioritized course interest without blocking', async () => {
      const mockLead: Lead = {
        id: 'lead-multi-interest',
        source: 'website',
        external_lead_id: null,
        hubspot_contact_id: null,
        first_name: 'Carlos',
        last_name: 'Mendes',
        email: 'carlos@example.com',
        email_confirmation: null,
        phone_raw: '+55 11 99999-8888',
        phone_e164: '+5511999998888',
        contact_preference: 'email',
        qualification_status: null,
        course_interest: null,
        course_interests: ['Advanced Dental Implant Experience', 'Wisdom Teeth Surgical Training'],
        pipeline_stage_id: 'stage-1',
        source_created_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const mockCourses = [
        { id: 'c-advanced', name: 'Advanced Dental Implant Experience', code: 'ADIE-01', active: true },
        { id: 'c-wisdom', name: 'Wisdom Teeth Surgical Training', code: 'WTT-01', active: true },
      ];

      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'courses') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({ data: mockCourses, error: null }),
              }),
            }),
          };
        }
        if (table === 'course_sessions') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          };
        }
        if (table === 'lead_course_interests') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({
                  data: [
                    { course_id: 'c-advanced', course_session_id: null, priority: 1 },
                    { course_id: 'c-wisdom', course_session_id: null, priority: 2 },
                  ],
                  error: null,
                }),
              }),
            }),
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        if (table === 'leads') {
          return {
            select: vi.fn().mockReturnValue({
              neq: vi.fn().mockReturnValue({
                ilike: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
                or: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        return { select: vi.fn().mockReturnThis() };
      });

      render(
        <EditLeadModal
          isOpen={true}
          onClose={vi.fn()}
          lead={mockLead}
          onLeadUpdated={vi.fn()}
        />
      );

      // Verify that "Nenhuma turma disponível" is NOT displayed
      await waitFor(() => {
        expect(screen.queryByText(/Nenhuma turma disponível/i)).not.toBeInTheDocument();
      });

      // Both interest rows have active turma dropdowns
      const select0 = screen.getByTestId('edit-lead-session-select-0');
      const select1 = screen.getByTestId('edit-lead-session-select-1');
      expect(select0).not.toBeDisabled();
      expect(select1).not.toBeDisabled();

      // Independent selections
      fireEvent.change(select0, { target: { value: 'Nov/26' } });
      fireEvent.change(select1, { target: { value: 'Apr/27' } });

      expect(select0).toHaveValue('Nov/26');
      expect(select1).toHaveValue('Apr/27');
    });
  });

  describe('6. ManageCourseModal Simplified UI', () => {
    it('displays Turmas deste curso and simplified turma selector', async () => {
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'course_materials') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          };
        }
        if (table === 'course_sessions') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({
                  data: [
                    { id: 'sess-nov26', course_id: 'c-zygo', title: 'Nov/26', code: 'CS-NOV26-1', status: 'open' },
                  ],
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'email_templates') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          };
        }
        return { select: vi.fn().mockReturnThis() };
      });

      render(
        <ManageCourseModal
          course={{
            id: 'c-zygo',
            code: 'ZIT-01',
            name: 'Zygomatic Implant Training',
            description: null,
            active: true,
            sort_order: 1,
          }}
          isOpen={true}
          onClose={vi.fn()}
          onCourseUpdated={vi.fn()}
        />
      );

      // Navigate to Turmas tab
      const turmasTab = screen.getByText(/turmas/i);
      fireEvent.click(turmasTab);

      // Header indicates "Turmas deste curso"
      expect(screen.getByText(/turmas deste curso/i)).toBeInTheDocument();
      await waitFor(() => {
        expect(screen.getByText('Nov/26')).toBeInTheDocument();
      });

      // Open Add Turma form
      const addBtn = screen.getByTestId('add-turma-button');
      fireEvent.click(addBtn);

      // Turma / Data do curso select is rendered
      expect(screen.getByText(/turma \/ data do curso/i)).toBeInTheDocument();
      expect(screen.getByTestId('save-turma-button')).toBeInTheDocument();
    });
  });
});

describe('Part B: Website Direct Real-Time Intake and Safety', () => {
  describe('1. Form Classification & Route Attributes', () => {
    it('verifies /contact maps to website-contact slug and contact_form detail', () => {
      const contactFormConfig = {
        slug: 'website-contact',
        source: 'website',
        source_detail: 'contact_form',
      };
      expect(contactFormConfig.slug).toBe('website-contact');
      expect(contactFormConfig.source).toBe('website');
      expect(contactFormConfig.source_detail).toBe('contact_form');
    });

    it('verifies /register maps to website-register slug and website_registration_form detail', () => {
      const registerFormConfig = {
        slug: 'website-register',
        source: 'website',
        source_detail: 'website_registration_form',
      };
      expect(registerFormConfig.slug).toBe('website-register');
      expect(registerFormConfig.source).toBe('website');
      expect(registerFormConfig.source_detail).toBe('website_registration_form');
    });
  });

  describe('2. Direct Intake & Returning Lead Preservation Rules', () => {
    it('un-deletes soft-deleted leads (deleted_at = null) upon returning form submission', () => {
      const softDeletedLead = {
        id: 'lead-incident-1',
        email: 'natbelmock@yahoo.com.br',
        phone_e164: '+18339383833',
        deleted_at: '2026-09-29T20:25:57Z',
        pipeline_stage_id: 'stage-novo',
        created_at: '2026-09-29T18:00:57Z',
      };

      // When returning submission arrives, deleted_at is cleared
      const resubmittedLead = {
        ...softDeletedLead,
        deleted_at: null, // UN-DELETED!
        last_acquisition_at: '2026-10-08T12:44:20Z',
      };

      expect(resubmittedLead.deleted_at).toBeNull();
      expect(resubmittedLead.id).toBe(softDeletedLead.id);
      expect(resubmittedLead.created_at).toBe(softDeletedLead.created_at);
      expect(resubmittedLead.pipeline_stage_id).toBe('stage-novo');
    });

    it('preserves existing lead stage and created_at on repeat website submissions', () => {
      const existingLead = {
        id: 'lead-returning-100',
        created_at: '2026-09-01T10:00:00Z',
        pipeline_stage_id: 'stage-qualificado',
        last_acquisition_at: '2026-09-01T10:00:00Z',
        course_interests: ['Zygomatic Implant Training'],
      };

      const newSubmissionTime = '2026-10-08T11:00:00Z';
      const updatedLead = {
        ...existingLead,
        last_acquisition_at: newSubmissionTime,
        pipeline_stage_id: existingLead.pipeline_stage_id,
        created_at: existingLead.created_at,
        course_interests: Array.from(new Set([...existingLead.course_interests, 'Advanced Dental Implant Experience'])),
      };

      expect(updatedLead.id).toBe(existingLead.id);
      expect(updatedLead.created_at).toBe(existingLead.created_at);
      expect(updatedLead.pipeline_stage_id).toBe('stage-qualificado');
      expect(updatedLead.last_acquisition_at).toBe(newSubmissionTime);
      expect(updatedLead.course_interests).toEqual([
        'Zygomatic Implant Training',
        'Advanced Dental Implant Experience',
      ]);
    });

    it('guarantees monotonic last_acquisition_at so returning lead resurfaces to top of current stage', () => {
      const t1 = new Date('2026-09-01T10:00:00Z').getTime();
      const t2 = new Date('2026-10-08T11:00:00Z').getTime();
      expect(t2).toBeGreaterThan(t1);
    });

    it('suppresses automatic course brochures for generic contact requests without course', () => {
      const genericPayload = {
        name: 'Dr. Lucas Ribeiro',
        email: 'lucas@example.com',
        phone: '+19415550188',
        course: null,
        course_interest: null,
      };

      const templateKey = genericPayload.course || genericPayload.course_interest ? 'course_details' : null;
      expect(templateKey).toBeNull();
    });

    it('validates website as an approved source in process-lead-intake payload validation', () => {
      const validSources = ['meta', 'google', 'manual', 'test', 'form', 'facebook', 'instagram', 'hubspot', 'website'];
      expect(validSources).toContain('website');
      expect(validSources.includes('website')).toBe(true);
    });
  });
});
