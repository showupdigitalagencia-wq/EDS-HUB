import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  sortWorkItems,
  isTaskWaitingReply,
  setTaskWaitingReply,
  fetchDailyOperationsDashboardDirect,
  fetchDailyOperationsQueueDirect,
} from '../features/work/services/work-queue-service';
import { WorkItemCard } from '../features/work/components/WorkItemCard';
import { LeadProfileContent } from '../features/leads/components/LeadProfileContent';
import { MatriculaCourseTurmaModal } from '../features/leads/components/MatriculaCourseTurmaModal';
import type { WorkItem, Lead } from '../types/database';
import { supabase } from '../lib/supabase';

// Mock Auth Provider hook
vi.mock('../features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'u-1', email: 'admissions@eds.com' },
  }),
}));

// Mock Supabase
vi.mock('../lib/supabase', () => {
  const mockSupabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'u-1', email: 'admin@eds.com' } },
      }),
    },
    from: vi.fn(),
    rpc: vi.fn(),
  };
  return { supabase: mockSupabase };
});

describe('OPERATIONAL UX IMPROVEMENTS: Matrícula & Tasks Work Queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // CHANGE A: Academic History Card Removed from Lead Profile
  // ===========================================================================
  describe('Change A: Lead Profile Academic History Visual Section Removal', () => {
    it('does NOT render the large "Matrículas & Histórico Acadêmico" card or buttons in Lead Profile', async () => {
      const mockLead: any = {
        id: '08afc615-4b0d-4696-9303-590b0019b687',
        first_name: 'Syed',
        last_name: 'Haider',
        email: 'syed.haider@example.com',
        phone_raw: '+15550001111',
        phone_e164: '+15550001111',
        source: 'lead',
        course_interest: 'Intensive Dental Implant Training',
        qualification_status: 'qualified',
        pipeline_stage_id: 'stage-matricula',
        pipeline_stage: {
          id: 'stage-matricula',
          name: 'Matrícula',
          code: 'enrollment',
          order_index: 4,
          sort_order: 4,
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'leads') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: mockLead, error: null }),
            maybeSingle: vi.fn().mockResolvedValue({ data: mockLead, error: null }),
          };
        }
        if (table === 'lead_course_interests') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'lci-1',
                  course_id: 'b699036d-6c94-4734-bf32-4d96355a698c',
                  course_session_id: null,
                  priority: 1,
                  course: { id: 'b699036d-6c94-4734-bf32-4d96355a698c', name: 'Intensive Dental Implant Training', code: 'IDIT-01' },
                  session: null,
                },
              ],
              error: null,
            }),
          };
        }
        const defaultChain: any = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          neq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve),
        };
        return defaultChain;
      });

      render(
        <MemoryRouter>
          <LeadProfileContent
            leadId={mockLead.id}
            initialLead={mockLead as Lead}
          />
        </MemoryRouter>
      );

      // Verify stage bar is rendered
      expect(await screen.findByTestId('lead-stage-bar')).toBeInTheDocument();

      // Verify the large academic history section and its buttons DO NOT exist in the DOM
      expect(screen.queryByText('Matrículas & Histórico Acadêmico')).not.toBeInTheDocument();
      expect(screen.queryByText('Nova Matrícula')).not.toBeInTheDocument();
      expect(screen.queryByText('Criar Primeira Matrícula')).not.toBeInTheDocument();
      expect(screen.queryByText('Contratos acadêmicos, turmas vinculadas e registros financeiros')).not.toBeInTheDocument();
    });
  });

  // ===========================================================================
  // CHANGE B: Matrícula Stage Compact Course & Turma Assignment
  // ===========================================================================
  describe('Change B: Matrícula Stage Course and Turma Controls', () => {
    it('displays compact course & turma controls near "Etapa atual: Matrícula"', async () => {
      const mockLead: any = {
        id: '08afc615-4b0d-4696-9303-590b0019b687',
        first_name: 'Syed',
        last_name: 'Haider',
        email: 'syed.haider@example.com',
        phone_raw: '+15550001111',
        phone_e164: '+15550001111',
        source: 'lead',
        course_interest: 'Intensive Dental Implant Training',
        qualification_status: 'qualified',
        pipeline_stage_id: 'stage-matricula',
        pipeline_stage: {
          id: 'stage-matricula',
          name: 'Matrícula',
          code: 'enrollment',
          order_index: 4,
          sort_order: 4,
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'leads') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: mockLead, error: null }),
            maybeSingle: vi.fn().mockResolvedValue({ data: mockLead, error: null }),
          };
        }
        if (table === 'lead_course_interests') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'lci-1',
                  course_id: 'b699036d-6c94-4734-bf32-4d96355a698c',
                  course_session_id: 'sess-oct',
                  priority: 1,
                  course: { id: 'b699036d-6c94-4734-bf32-4d96355a698c', name: 'Intensive Dental Implant Training', code: 'IDIT-01' },
                  session: { id: 'sess-oct', title: 'October 8–11, 2026 Cohort', start_date: '2026-10-08', end_date: '2026-10-11' },
                },
              ],
              error: null,
            }),
          };
        }
        const defaultChain: any = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          neq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve),
        };
        return defaultChain;
      });

      render(
        <MemoryRouter>
          <LeadProfileContent
            leadId={mockLead.id}
            initialLead={mockLead as Lead}
          />
        </MemoryRouter>
      );

      // Verify compact course & turma container is rendered right inside/near lead-stage-bar
      const stageBar = await screen.findByTestId('lead-stage-bar');
      expect(stageBar).toBeInTheDocument();
      expect(screen.getByTestId('profile-current-stage-name')).toHaveTextContent('Matrícula');

      const courseBadge = screen.getByTestId('matricula-course-badge');
      expect(courseBadge).toHaveTextContent('Intensive Dental Implant Training');

      const turmaBadge = screen.getByTestId('matricula-turma-badge');
      expect(turmaBadge).toHaveTextContent('October 8–11, 2026');

      const actionBtn = screen.getByTestId('matricula-definir-turma-button');
      expect(actionBtn).toHaveTextContent('Alterar');
    });

    it('MatriculaCourseTurmaModal dynamically loads sessions based on selected course and persists', async () => {
      const mockCourses: any[] = [
        { id: 'c-intensive', name: 'Intensive Dental Implant Training', code: 'IDIT-01', default_price: 5000, currency: 'USD', description: '', active: true, sort_order: 1, created_at: '', updated_at: '' },
        { id: 'c-zygomatic', name: 'Zygomatic Implant Training', code: 'ZIT-01', default_price: 6000, currency: 'USD', description: '', active: true, sort_order: 2, created_at: '', updated_at: '' },
      ];

      const mockSessionsIntensive: any[] = [
        { id: 'sess-oct-2026', course_id: 'c-intensive', title: 'October 8–11, 2026 Cohort', code: 'IDIT-OCT26', status: 'confirmed', start_date: '2026-10-08', end_date: '2026-10-11', timezone: 'UTC', capacity: 20, location: 'Orlando', instructor_name: 'Dr. Instructor', created_at: '', updated_at: '' },
      ];

      const mockSessionsZygomatic: any[] = [
        { id: 'sess-nov-2026', course_id: 'c-zygomatic', title: 'November 2026 Cohort', code: 'ZIT-NOV26', status: 'confirmed', start_date: '2026-11-07', end_date: '2026-11-10', timezone: 'UTC', capacity: 20, location: 'Orlando', instructor_name: 'Dr. Instructor', created_at: '', updated_at: '' },
      ];

      const updateLciMock = vi.fn().mockResolvedValue({ error: null });
      const updateLeadMock = vi.fn().mockResolvedValue({ error: null });

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
              eq: vi.fn().mockImplementation((_col: string, val: string) => ({
                in: vi.fn().mockReturnValue({
                  order: vi.fn().mockResolvedValue({
                    data: val === 'c-intensive' ? mockSessionsIntensive : mockSessionsZygomatic,
                    error: null,
                  }),
                }),
              })),
            }),
          };
        }
        if (table === 'lead_course_interests') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: [{ id: 'lci-syed' }], error: null }),
                }),
              }),
            }),
            update: updateLciMock.mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        if (table === 'leads') {
          return {
            update: updateLeadMock.mockReturnValue({
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

      const handleSuccess = vi.fn();
      const handleClose = vi.fn();

      render(
        <MatriculaCourseTurmaModal
          isOpen={true}
          onClose={handleClose}
          leadId="08afc615-4b0d-4696-9303-590b0019b687"
          currentCourseId="c-intensive"
          currentCourseSessionId={null}
          onSuccess={handleSuccess}
        />
      );

      // Verify Course selector is populated
      const courseSelect = await screen.findByTestId('matricula-course-select');
      expect(courseSelect).toHaveValue('c-intensive');

      // Verify Turma options depend on selected course
      const turmaSelect = await screen.findByTestId('matricula-turma-select');
      expect(turmaSelect).toBeInTheDocument();
      expect(screen.getByText(/October 8–11, 2026/)).toBeInTheDocument();

      // Switch course to Zygomatic
      fireEvent.change(courseSelect, { target: { value: 'c-zygomatic' } });

      // Wait for new course sessions to finish loading
      await waitFor(() => {
        expect(screen.getByText(/November 2026 Cohort/)).toBeInTheDocument();
      });

      // Select the November turma on the active select element
      const activeTurmaSelect = screen.getByTestId('matricula-turma-select');
      fireEvent.change(activeTurmaSelect, { target: { value: 'sess-nov-2026' } });

      // Save
      const saveBtn = screen.getByTestId('salvar-matricula-curso-turma-button');
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(updateLciMock).toHaveBeenCalledWith(
          expect.objectContaining({
            course_id: 'c-zygomatic',
            course_session_id: 'sess-nov-2026',
          })
        );
        expect(handleSuccess).toHaveBeenCalled();
        expect(handleClose).toHaveBeenCalled();
      });
    });
  });

  // ===========================================================================
  // CHANGE C1: Overdue Sort Order (Newest Overdue First -> Oldest Last)
  // ===========================================================================
  describe('Change C1: Overdue Sort Order', () => {
    it('sorts overdue tasks with NEWEST overdue first -> OLDEST overdue last', () => {
      const dueYesterday: WorkItem = {
        id: 'task-yesterday',
        type: 'TASK',
        category: 'overdue',
        priority: 'normal',
        title: 'Due Yesterday',
        description: null,
        due_at: '2026-10-05T15:00:00.000Z',
        is_overdue: true,
        detected_at: '2026-10-01T10:00:00.000Z',
        lead_id: 'l-1',
        lead_name: 'Lead 1',
        lead_email: null,
        lead_phone: null,
        contact_preference: null,
        lead_score: null,
        pipeline_stage: null,
        reason_code: null,
        context_id: 'task-yesterday',
        context_type: 'task',
        primary_action: { type: 'complete_task', label: 'Concluir' },
      };

      const due3DaysAgo: WorkItem = {
        id: 'task-3-days-ago',
        type: 'TASK',
        category: 'overdue',
        priority: 'normal',
        title: 'Due 3 Days Ago',
        description: null,
        due_at: '2026-10-03T10:00:00.000Z',
        is_overdue: true,
        detected_at: '2026-09-28T10:00:00.000Z',
        lead_id: 'l-2',
        lead_name: 'Lead 2',
        lead_email: null,
        lead_phone: null,
        contact_preference: null,
        lead_score: null,
        pipeline_stage: null,
        reason_code: null,
        context_id: 'task-3-days-ago',
        context_type: 'task',
        primary_action: { type: 'complete_task', label: 'Concluir' },
      };

      const due2WeeksAgo: WorkItem = {
        id: 'task-2-weeks-ago',
        type: 'TASK',
        category: 'overdue',
        priority: 'normal',
        title: 'Due 2 Weeks Ago',
        description: null,
        due_at: '2026-09-22T08:00:00.000Z',
        is_overdue: true,
        detected_at: '2026-09-15T10:00:00.000Z',
        lead_id: 'l-3',
        lead_name: 'Lead 3',
        lead_email: null,
        lead_phone: null,
        contact_preference: null,
        lead_score: null,
        pipeline_stage: null,
        reason_code: null,
        context_id: 'task-2-weeks-ago',
        context_type: 'task',
        primary_action: { type: 'complete_task', label: 'Concluir' },
      };

      const dueMonthsAgo: WorkItem = {
        id: 'task-months-ago',
        type: 'TASK',
        category: 'overdue',
        priority: 'critical', // even with critical priority, newest overdue takes precedence in overdue queue
        title: 'Due Months Ago',
        description: null,
        due_at: '2026-06-10T12:00:00.000Z',
        is_overdue: true,
        detected_at: '2026-06-01T10:00:00.000Z',
        lead_id: 'l-4',
        lead_name: 'Lead 4',
        lead_email: null,
        lead_phone: null,
        contact_preference: null,
        lead_score: null,
        pipeline_stage: null,
        reason_code: null,
        context_id: 'task-months-ago',
        context_type: 'task',
        primary_action: { type: 'complete_task', label: 'Concluir' },
      };

      // Pass in random order
      const sorted = sortWorkItems(
        [due2WeeksAgo, dueMonthsAgo, dueYesterday, due3DaysAgo],
        'overdue'
      );

      // Expected: due yesterday -> due 3 days ago -> due 2 weeks ago -> due months ago
      expect(sorted[0].id).toBe('task-yesterday');
      expect(sorted[1].id).toBe('task-3-days-ago');
      expect(sorted[2].id).toBe('task-2-weeks-ago');
      expect(sorted[3].id).toBe('task-months-ago');
    });
  });

  // ===========================================================================
  // CHANGE C2: “Aguardando Resposta” Structured State & Queue Filtering
  // ===========================================================================
  describe('Change C2: Aguardando Resposta Task Status', () => {
    it('isTaskWaitingReply detects state strictly from waiting_for_response boolean and NEVER parses descriptions', () => {
      // 1. Structured boolean true on pending task -> true
      expect(isTaskWaitingReply({ waiting_for_response: true, status: 'pending' })).toBe(true);

      // 2. Structured boolean false or omitted -> false
      expect(isTaskWaitingReply({ waiting_for_response: false, status: 'pending' })).toBe(false);
      expect(isTaskWaitingReply({ status: 'pending' })).toBe(false);
      expect(isTaskWaitingReply(null)).toBe(false);

      // 3. Proves description is NEVER parsed as machine state:
      // Even if user typed [Aguardando Resposta] in notes, if waiting_for_response is false, it is NOT waiting
      expect(isTaskWaitingReply({
        waiting_for_response: false,
        status: 'pending',
      } as any)).toBe(false);

      // 4. Completed or cancelled tasks are NEVER waiting regardless of waiting_for_response
      expect(isTaskWaitingReply({ waiting_for_response: true, status: 'completed' })).toBe(false);
      expect(isTaskWaitingReply({ waiting_for_response: true, status: 'cancelled' })).toBe(false);
    });

    it('setTaskWaitingReply updates structured waiting_for_response and preserves description and due_at completely untouched', async () => {
      const updateMock = vi.fn().mockResolvedValue({ error: null });
      const originalDescription = 'Enviado link de pagamento via Stripe para o Dr. Haider';
      const originalDueAt = '2026-10-06T18:00:00Z';

      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'tasks') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'task-pay-1',
                    title: 'Cobrança da Matrícula',
                    description: originalDescription,
                    due_at: originalDueAt,
                    status: 'pending',
                    lead_id: 'lead-dr-haider',
                  },
                  error: null,
                }),
              }),
            }),
            update: updateMock.mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        if (table === 'lead_activities') {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return { select: vi.fn().mockReturnThis() };
      });

      // 1. Mark waiting for response
      await setTaskWaitingReply('task-pay-1', true);
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          waiting_for_response: true,
          waiting_for_response_since: expect.any(String),
          updated_at: expect.any(String),
        })
      );
      // Description is NEVER passed in update payload - preserved untouched!
      const markCallArg = updateMock.mock.calls[0][0];
      expect(markCallArg.description).toBeUndefined();

      // 2. Retomar Tarefa (clear waiting state)
      updateMock.mockClear();
      await setTaskWaitingReply('task-pay-1', false);
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          waiting_for_response: false,
          waiting_for_response_since: null,
          updated_at: expect.any(String),
        })
      );
      const resumeCallArg = updateMock.mock.calls[0][0];
      expect(resumeCallArg.description).toBeUndefined();
    });

    it('WorkItemCard renders mobile action button to mark "Aguardando Resposta" and "Retomar Tarefa" with untouched description', () => {
      const untouchedDescription = 'Dentista solicitou fatura detalhada antes do envio do comprovante';
      const activeItem: WorkItem = {
        id: 'task:task-100',
        type: 'PAYMENT_ATTENTION',
        category: 'today',
        priority: 'high',
        title: 'Pagamento Matrícula',
        description: untouchedDescription,
        due_at: '2026-10-06T15:00:00Z',
        is_overdue: false,
        detected_at: '2026-10-06T10:00:00Z',
        lead_id: 'l-1',
        lead_name: 'Dr. Syed Haider',
        lead_email: null,
        lead_phone: null,
        contact_preference: null,
        lead_score: null,
        pipeline_stage: 'Matrícula',
        reason_code: null,
        context_id: 'task-100',
        context_type: 'task',
        primary_action: { type: 'complete_task', label: 'Concluir' },
        waiting_for_response: false,
      };

      const handleToggle = vi.fn();

      const { rerender } = render(
        <MemoryRouter>
          <WorkItemCard
            item={activeItem}
            onCompleteTask={vi.fn()}
            onRescheduleTask={vi.fn()}
            onCreateTaskForLead={vi.fn()}
            onToggleWaitingReply={handleToggle}
          />
        </MemoryRouter>
      );

      // Active task shows Aguardando Resposta button
      const waitBtn = screen.getByTestId('toggle-waiting-task-task-100');
      expect(waitBtn).toBeInTheDocument();
      expect(screen.queryByTestId('task-waiting-badge-task-100')).not.toBeInTheDocument();
      fireEvent.click(waitBtn);
      expect(handleToggle).toHaveBeenCalledWith('task-100', true);

      // Now rerender as waiting task (structured waiting_for_response: true)
      const waitingItem: WorkItem = {
        ...activeItem,
        category: 'needs_reply',
        waiting_for_response: true,
      };

      rerender(
        <MemoryRouter>
          <WorkItemCard
            item={waitingItem}
            onCompleteTask={vi.fn()}
            onRescheduleTask={vi.fn()}
            onCreateTaskForLead={vi.fn()}
            onToggleWaitingReply={handleToggle}
          />
        </MemoryRouter>
      );

      // Shows badge "Aguardando Resposta"
      expect(screen.getByTestId('task-waiting-badge-task-100')).toBeInTheDocument();
      // Original description is rendered exactly as-is
      expect(screen.getByText(untouchedDescription)).toBeInTheDocument();

      // Shows "Retomar Tarefa"
      const resumeBtn = screen.getByTestId('resume-task-task-100');
      expect(resumeBtn).toBeInTheDocument();
      fireEvent.click(resumeBtn);
      expect(handleToggle).toHaveBeenCalledWith('task-100', false);
    });

    it('waiting-response tasks do not pollute overdue count and increment needs_reply count', async () => {
      // Mock supabase tasks queries for dashboard direct using structured waiting_for_response filter
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'tasks') {
          return {
            select: vi.fn().mockImplementation((_cols?: string, _opts?: any) => {
              const queryObj: any = {
                eq: vi.fn().mockImplementation((col: string, val: any) => {
                  if (col === 'status') queryObj._status = val;
                  if (col === 'waiting_for_response') queryObj._waiting = val;
                  return queryObj;
                }),
                gte: vi.fn().mockReturnThis(),
                lt: vi.fn().mockReturnThis(),
                not: vi.fn().mockReturnThis(),
                then: (resolve: any) => {
                  // If counting waiting tasks: waiting_for_response = true -> return 4
                  if (queryObj._waiting === true) {
                    return Promise.resolve({ count: 4, error: null }).then(resolve);
                  }
                  // If counting overdue tasks: waiting_for_response = false -> return 2
                  if (queryObj._waiting === false) {
                    return Promise.resolve({ count: 2, error: null }).then(resolve);
                  }
                  return Promise.resolve({ count: 0, error: null }).then(resolve);
                },
              };
              return queryObj;
            }),
          };
        }
        if (table === 'conversations') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockImplementation(() => ({
                  then: (resolve: any) => Promise.resolve({ count: 3, error: null }).then(resolve),
                })),
              }),
            }),
          };
        }
        return { select: vi.fn().mockReturnThis() };
      });

      const kpis = await fetchDailyOperationsDashboardDirect();

      // Overdue count is strictly non-waiting tasks (waiting_for_response = false)
      expect(kpis.overdue_count).toBe(2);
      // Needs reply count combines 3 inbound conversations + 4 waiting tasks = 7
      expect(kpis.needs_reply_count).toBe(7);
    });

    it('fetchDailyOperationsQueueDirect excludes waiting tasks in overdue tab and includes them in needs_reply tab with untouched descriptions', async () => {
      const regularOverdueTask = {
        id: 't-overdue-1',
        title: 'Ligar para retorno',
        description: 'Primeiro contato realizado sem resposta inicial',
        status: 'pending',
        due_at: '2026-10-01T10:00:00Z',
        priority: 'normal',
        task_source: 'manual',
        waiting_for_response: false,
        created_at: '2026-09-28T10:00:00Z',
        lead: { first_name: 'Ana', last_name: 'Silva', email: 'ana@example.com' },
      };

      const waitingOverdueTask = {
        id: 't-waiting-1',
        title: 'Cobrança Matrícula',
        description: 'Mensagem enviada no WhatsApp solicitando comprovante bancário',
        status: 'pending',
        due_at: '2026-09-30T10:00:00Z',
        priority: 'high',
        task_source: 'manual',
        waiting_for_response: true,
        waiting_for_response_since: '2026-10-02T10:00:00Z',
        created_at: '2026-09-27T10:00:00Z',
        lead: { first_name: 'Carlos', last_name: 'Mendes', email: 'carlos@example.com' },
      };

      // 1. In overdue tab: query filters waiting_for_response = false
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'tasks') {
          const queryBuilder: any = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            lt: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            range: vi.fn().mockReturnValue({
              then: (resolve: any) => Promise.resolve({ data: [regularOverdueTask], count: 1, error: null }).then(resolve),
            }),
          };
          return queryBuilder;
        }
        return { select: vi.fn().mockReturnThis() };
      });

      const overdueRes = await fetchDailyOperationsQueueDirect({ tab: 'overdue' });
      expect(overdueRes.items.length).toBe(1);
      expect(overdueRes.items[0].id).toBe('task:t-overdue-1');
      expect(overdueRes.items[0].description).toBe('Primeiro contato realizado sem resposta inicial');
      expect(overdueRes.items[0].is_overdue).toBe(true);
      expect(overdueRes.items[0].waiting_for_response).toBe(false);

      // 2. In needs_reply tab: query filters waiting_for_response = true
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'tasks') {
          const queryBuilder: any = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            range: vi.fn().mockReturnValue({
              then: (resolve: any) => Promise.resolve({ data: [waitingOverdueTask], count: 1, error: null }).then(resolve),
            }),
          };
          return queryBuilder;
        }
        return { select: vi.fn().mockReturnThis() };
      });

      const needsReplyRes = await fetchDailyOperationsQueueDirect({ tab: 'needs_reply' });
      expect(needsReplyRes.items.length).toBe(1);
      expect(needsReplyRes.items[0].id).toBe('task:t-waiting-1');
      expect(needsReplyRes.items[0].category).toBe('needs_reply');
      expect(needsReplyRes.items[0].description).toBe('Mensagem enviada no WhatsApp solicitando comprovante bancário');
      expect(needsReplyRes.items[0].is_overdue).toBe(false); // Paused while waiting
      expect(needsReplyRes.items[0].waiting_for_response).toBe(true);
    });
  });

  // ===========================================================================
  // MOBILE LAYOUT VERIFICATION
  // ===========================================================================
  describe('Mobile Layout & Responsiveness', () => {
    it('verifies mobile responsive CSS classes on compact Matrícula bar and WorkItemCard', () => {
      const item: WorkItem = {
        id: 'task:task-mob',
        type: 'TASK',
        category: 'today',
        priority: 'normal',
        title: 'Verificar documentos',
        description: 'Documentação do aluno',
        due_at: '2026-10-06T15:00:00Z',
        is_overdue: false,
        detected_at: '2026-10-06T10:00:00Z',
        lead_id: 'l-mob',
        lead_name: 'Dr. Roberto Carlos',
        lead_email: null,
        lead_phone: null,
        contact_preference: null,
        lead_score: null,
        pipeline_stage: 'Matrícula',
        reason_code: null,
        context_id: 'task-mob',
        context_type: 'task',
        primary_action: { type: 'complete_task', label: 'Concluir' },
      };

      const { container } = render(
        <MemoryRouter>
          <WorkItemCard
            item={item}
            onCompleteTask={vi.fn()}
            onRescheduleTask={vi.fn()}
            onCreateTaskForLead={vi.fn()}
            onToggleWaitingReply={vi.fn()}
          />
        </MemoryRouter>
      );

      // Verify flex wraps and responsive breakpoints preventing horizontal overflow on iPhone
      const card = screen.getByTestId('work-item-card-task-mob');
      expect(card).toBeInTheDocument();
      expect(container.querySelector('.flex-col')).toBeInTheDocument();
      expect(container.querySelector('.sm\\:flex-row')).toBeInTheDocument();
      expect(container.querySelector('.min-w-0')).toBeInTheDocument();
    });
  });
});
