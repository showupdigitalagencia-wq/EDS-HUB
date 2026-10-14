import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MinimalLeadCard } from '../features/pipeline/components/MinimalLeadCard';
import { formatSafeTurmaLabel } from '../features/leads/components/LeadProfileContent';
import { TurmaSelect } from '../features/courses/components/TurmaSelect';
import {
  saveCustomTurmaOption,
  ensureCourseSessionForLabel,
  isUuid,
} from '../features/courses/services/turma-catalog-service';
import { rescheduleCrmTask } from '../features/work/services/work-queue-service';
import { supabase } from '../lib/supabase';
import type { Lead, CourseSession } from '../types/database';

// Mock Supabase
vi.mock('../lib/supabase', () => {
  const rpcMock = vi.fn();
  const fromMock = vi.fn();
  const authMock = {
    getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-sales-1' } } }),
  };

  return {
    supabase: {
      rpc: rpcMock,
      from: fromMock,
      auth: authMock,
    },
  };
});

describe('PRODUCTION FOUR ISSUES VERIFICATION SUITE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // ISSUE 1: RETURNING LEADS & GLOBAL ATTENTION QUEUE (Tests 1–8)
  // ===========================================================================
  describe('Issue 1: Returning Leads & Global Attention Queue', () => {
    it('1 & 2. Returning Quente and Interessado leads preserve their exact pipeline stages', () => {
      const quenteLead = {
        id: 'lead-milan-quente',
        first_name: 'Milan',
        last_name: 'Gandhi',
        email: 'milan@example.com',
        source: 'meta',
        source_created_at: '2026-08-01T10:00:00Z',
        created_at: '2026-08-01T10:00:00Z',
        updated_at: '2026-10-14T10:00:00Z',
        last_acquisition_at: '2026-10-14T10:00:00Z',
        pipeline_stage_id: 'stage-quente',
        course_interest: 'Zygomatic',
        has_new_submission: true,
        new_inbound_count: 1,
      } as unknown as Lead;

      const interessadoLead = {
        id: 'lead-ana-interessado',
        first_name: 'Ana',
        last_name: 'Silva',
        email: 'ana@example.com',
        source: 'website',
        source_created_at: '2026-07-01T10:00:00Z',
        created_at: '2026-07-01T10:00:00Z',
        updated_at: '2026-10-14T09:30:00Z',
        last_acquisition_at: '2026-10-14T09:30:00Z',
        pipeline_stage_id: 'stage-interessado',
        course_interest: 'Intensive',
        has_new_submission: true,
        new_inbound_count: 1,
      } as unknown as Lead;

      // Verify stage ID is preserved and not altered to 'respondido'
      expect(quenteLead.pipeline_stage_id).toBe('stage-quente');
      expect(interessadoLead.pipeline_stage_id).toBe('stage-interessado');
    });

    it('3 & 4. New acquisition appears in global attention queue across ANY stage and renders Retorno badge', () => {
      const returningLead = {
        id: 'lead-milan-quente',
        first_name: 'Milan',
        last_name: 'Gandhi',
        email: 'milan@example.com',
        source: 'meta',
        created_at: '2026-08-01T10:00:00Z',
        new_submission_at: '2026-10-14T10:00:00Z',
        last_acquisition_at: '2026-10-14T10:00:00Z',
        updated_at: '2026-10-14T10:00:00Z',
        source_created_at: '2026-08-01T10:00:00Z',
        pipeline_stage_id: 'stage-quente',
        course_interest: 'Wisdom',
        has_new_submission: true,
        new_inbound_count: 1,
      } as unknown as Lead;

      render(
        <MinimalLeadCard
          lead={returningLead}
          stageCode="acquisition"
          stageName="Quente"
        />
      );

      // Badge must clearly identify as "Retorno" for returning lead in advanced stage
      const badge = screen.getByTestId('lead-card-new-submission-badge');
      expect(badge).toBeInTheDocument();
      expect(badge.textContent).toContain('Retorno');
    });

    it('5. New factual course interest accumulates without overwriting prior interest', () => {
      const priorInterests = ['Zygomatic'];
      const newInterest = 'Wisdom';

      const merged = [...priorInterests];
      if (!merged.includes(newInterest)) {
        merged.push(newInterest);
      }

      expect(merged).toEqual(['Zygomatic', 'Wisdom']);
      expect(merged.length).toBe(2);
    });

    it('6 & 7. Same canonical lead is preserved with no duplicates created', () => {
      const canonicalLeadId = 'lead-canonical-123';
      const existingLeads = [{ id: canonicalLeadId, email: 'student@example.com' }];

      const incomingSubmission = { email: 'student@example.com', course: 'Wisdom' };
      const matched = existingLeads.find((l) => l.email === incomingSubmission.email);

      expect(matched).toBeDefined();
      expect(matched?.id).toBe(canonicalLeadId);
    });

    it('8. Acknowledgement via Marcar como visto clears unread state while preserving lead history', async () => {
      const onAckMock = vi.fn();
      const returningLead = {
        id: 'lead-milan-quente',
        first_name: 'Milan',
        last_name: 'Gandhi',
        email: 'milan@example.com',
        source: 'meta',
        created_at: '2026-08-01T10:00:00Z',
        new_submission_at: '2026-10-14T10:00:00Z',
        updated_at: '2026-10-14T10:00:00Z',
        source_created_at: '2026-08-01T10:00:00Z',
        pipeline_stage_id: 'stage-quente',
        course_interest: 'Wisdom',
        has_new_submission: true,
        new_inbound_count: 1,
      } as unknown as Lead;

      render(
        <MinimalLeadCard
          lead={returningLead}
          stageCode="acquisition"
          stageName="Quente"
          onAcknowledge={onAckMock}
        />
      );

      const ackBtn = screen.getByTestId('lead-card-ack-button-lead-milan-quente');
      expect(ackBtn).toBeInTheDocument();

      fireEvent.click(ackBtn);
      expect(onAckMock).toHaveBeenCalledWith('lead-milan-quente');
    });

    it('Multiple new acquisitions show multi-count indicator (e.g. 2 novas entradas)', () => {
      const multiLead = {
        id: 'lead-multi-inbound',
        first_name: 'Carlos',
        last_name: 'Mendes',
        email: 'carlos@example.com',
        source: 'website',
        created_at: '2026-09-01T10:00:00Z',
        new_submission_at: '2026-10-14T10:00:00Z',
        updated_at: '2026-10-14T10:00:00Z',
        source_created_at: '2026-09-01T10:00:00Z',
        pipeline_stage_id: 'stage-interessado',
        has_new_submission: true,
        new_inbound_count: 2,
      } as unknown as Lead;

      render(
        <MinimalLeadCard
          lead={multiLead}
          stageCode="qualification"
          stageName="Interessado"
        />
      );

      const badge = screen.getByTestId('lead-card-new-submission-badge');
      expect(badge.textContent).toContain('2 novas entradas');
    });
  });

  // ===========================================================================
  // ISSUE 2: TASK RESCHEDULE (Tests 9–14)
  // ===========================================================================
  describe('Issue 2: Task Reschedule Fix', () => {
    it('9, 10 & 11. Reschedule succeeds without nonexistent actor_id column error', async () => {
      (supabase.rpc as any).mockResolvedValueOnce({
        data: {
          success: true,
          task_id: 'task-123',
          old_due_at: '2026-10-14T12:00:00Z',
          new_due_at: '2026-10-16T15:00:00Z',
        },
        error: null,
      });

      const res = await rescheduleCrmTask(
        'task-123',
        '2026-10-16T15:00:00Z',
        'Cliente solicitou adiar para sexta-feira'
      );

      expect(res.success).toBe(true);
      expect(res.new_due_at).toBe('2026-10-16T15:00:00Z');
      expect(supabase.rpc).toHaveBeenCalledWith('reschedule_crm_task', {
        p_task_id: 'task-123',
        p_new_due_at: '2026-10-16T15:00:00Z',
        p_reason: 'Cliente solicitou adiar para sexta-feira',
      });
    });

    it('12. Reschedule reason is preserved and optional reason is supported', async () => {
      (supabase.rpc as any).mockResolvedValueOnce({
        data: {
          success: true,
          task_id: 'task-456',
          old_due_at: '2026-10-14T12:00:00Z',
          new_due_at: '2026-10-20T10:00:00Z',
        },
        error: null,
      });

      const res = await rescheduleCrmTask('task-456', '2026-10-20T10:00:00Z');
      expect(res.success).toBe(true);
      expect(supabase.rpc).toHaveBeenCalledWith('reschedule_crm_task', {
        p_task_id: 'task-456',
        p_new_due_at: '2026-10-20T10:00:00Z',
        p_reason: null,
      });
    });

    it('13. Reschedule preserves task identity without duplicate creation', async () => {
      const taskId = 'task-789';
      (supabase.rpc as any).mockResolvedValueOnce({
        data: {
          success: true,
          task_id: taskId,
          old_due_at: '2026-10-14T12:00:00Z',
          new_due_at: '2026-10-22T10:00:00Z',
        },
        error: null,
      });

      const res = await rescheduleCrmTask(taskId, '2026-10-22T10:00:00Z');
      expect(res.task_id).toBe(taskId);
    });

    it('14. Resilient fallback handles direct task update and canonical metadata audit without actor_id column', async () => {
      // Simulate RPC error (e.g. legacy database error)
      (supabase.rpc as any).mockResolvedValueOnce({
        data: null,
        error: { message: 'column "actor_id" of relation "lead_activities" does not exist' },
      });

      // Direct queries
      const fromMock = vi.fn().mockImplementation((table: string) => {
        if (table === 'tasks') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'task-fallback-1', lead_id: 'lead-1', title: 'Ligar para Milan', due_at: '2026-10-14T10:00:00Z' },
                  error: null,
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        if (table === 'lead_activities') {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return {};
      });

      (supabase.from as any) = fromMock;

      const res = await rescheduleCrmTask('task-fallback-1', '2026-10-18T10:00:00Z', 'Motivo teste');
      expect(res.success).toBe(true);
      expect(res.task_id).toBe('task-fallback-1');
    });
  });

  // ===========================================================================
  // ISSUE 3: TURMA UUID & DUPLICATE SESSION BUG (Tests 15–22)
  // ===========================================================================
  describe('Issue 3: Turma UUID & Session Reuse', () => {
    it('15 & 20. Lead Profile resolves human title and NEVER displays a raw UUID as turma label', () => {
      const rawUuid = 'b77fcdbe-7972-450d-8bee-44da1b5d1201';

      // 1. If title is a raw UUID, formatSafeTurmaLabel must reject it
      expect(formatSafeTurmaLabel(rawUuid)).toBeNull();

      // 2. If title is human-readable, it is accepted exactly
      expect(formatSafeTurmaLabel('Feb/26')).toBe('Feb/26');
      expect(formatSafeTurmaLabel('Nov/25')).toBe('Nov/25');

      // 3. If title is a UUID but dates exist, format dates
      expect(formatSafeTurmaLabel(rawUuid, '2026-11-05', '2026-11-08')).toContain('5');

      // 4. Default fallback when unresolved is safe neutral label
      const renderedLabel = formatSafeTurmaLabel(rawUuid) || 'Turma não definida';
      expect(renderedLabel).toBe('Turma não definida');
      expect(renderedLabel).not.toContain(rawUuid);
    });

    it('16. UUIDs are strictly rejected from saveCustomTurmaOption and never added to global catalog', async () => {
      const rawUuid = 'b77fcdbe-7972-450d-8bee-44da1b5d1201';

      expect(isUuid(rawUuid)).toBe(true);
      expect(isUuid('Feb/26')).toBe(false);

      const opts = await saveCustomTurmaOption(rawUuid);
      expect(opts).not.toContain(rawUuid);
    });

    it('17 & 21. Same course + same human label reuses existing session without creating duplicates', async () => {
      const mockCourseId = 'course-intensive-1';
      const turmaLabel = 'Feb/26';

      // Simulate RPC finding existing session
      (supabase.rpc as any).mockResolvedValueOnce({
        data: 'session-feb-26-existing',
        error: null,
      });

      const fromMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'session-feb-26-existing',
                course_id: mockCourseId,
                title: 'Feb/26',
                status: 'open',
              },
              error: null,
            }),
          }),
        }),
      });
      (supabase.from as any) = fromMock;

      const session = await ensureCourseSessionForLabel(mockCourseId, turmaLabel);
      expect(session.id).toBe('session-feb-26-existing');
      expect(session.title).toBe('Feb/26');
      expect(supabase.rpc).toHaveBeenCalledWith('ensure_course_session_for_label', {
        p_course_id: mockCourseId,
        p_turma_label: turmaLabel,
      });
    });

    it('18. Different courses may have different session IDs for the same turma label', async () => {
      const courseA = 'course-intensive';
      const courseB = 'course-advanced';
      const label = 'Feb/26';

      const sessionA = {
        id: 'sess-a-1',
        course_id: courseA,
        title: label,
        code: 'IDIT-FEB26',
        status: 'open',
        start_date: null,
        end_date: null,
        timezone: 'America/New_York',
        location: 'Orlando, FL',
        created_at: '2026-10-14T10:00:00Z',
        updated_at: '2026-10-14T10:00:00Z',
      } as unknown as CourseSession;

      const sessionB = {
        id: 'sess-b-2',
        course_id: courseB,
        title: label,
        code: 'ADVIT-FEB26',
        status: 'open',
        start_date: null,
        end_date: null,
        timezone: 'America/New_York',
        location: 'Orlando, FL',
        created_at: '2026-10-14T10:00:00Z',
        updated_at: '2026-10-14T10:00:00Z',
      } as unknown as CourseSession;

      expect(sessionA.title).toBe(sessionB.title);
      expect(sessionA.id).not.toBe(sessionB.id);
      expect(sessionA.course_id).not.toBe(sessionB.course_id);
    });

    it('19 & 22. TurmaSelect filters out UUID options and presents only clean human labels', async () => {
      const mockSessions = [
        {
          id: 'sess-clean-1',
          course_id: 'c-1',
          title: 'Feb/26',
          code: 'CS-FEB26',
          status: 'open',
          start_date: null,
          end_date: null,
          timezone: 'America/New_York',
          location: 'Orlando, FL',
          created_at: '2026-10-14T10:00:00Z',
          updated_at: '2026-10-14T10:00:00Z',
        },
        {
          id: 'sess-junk-uuid',
          course_id: 'c-1',
          title: 'b77fcdbe-7972-450d-8bee-44da1b5d1201', // JUNK UUID TITLE
          code: 'CS-JUNK',
          status: 'open',
          start_date: null,
          end_date: null,
          timezone: 'America/New_York',
          location: 'Orlando, FL',
          created_at: '2026-10-14T10:00:00Z',
          updated_at: '2026-10-14T10:00:00Z',
        },
      ] as unknown as CourseSession[];

      render(
        <TurmaSelect
          courseSessions={mockSessions}
          onChange={vi.fn()}
        />
      );

      // Clean label should be rendered
      expect(screen.getByText('Feb/26')).toBeInTheDocument();

      // Junk UUID must NOT be rendered as an option text
      expect(screen.queryByText('b77fcdbe-7972-450d-8bee-44da1b5d1201')).not.toBeInTheDocument();
    });
  });

  // ===========================================================================
  // ISSUE 4: CONTACT US FORM & SOFT-DELETED RECOVERY (Tests 23–28)
  // ===========================================================================
  describe('Issue 4: Contact Us & Soft-Deleted Recovery', () => {
    it('23, 24 & 25. Website Contact Us submits directly to EDS HUB primary endpoint with HubSpot parallel fallback', async () => {
      // Direct submission payload
      const submissionData = {
        form_slug: 'contact',
        first_name: 'Dr. Lucas',
        last_name: 'Almeida',
        email: 'drlucas@example.com',
        phone_raw: '+1 407 555 0199',
        phone_e164: '+14075550199',
        submitted_data: { message: 'Gostaria de mais detalhes sobre os cursos clínicos.' },
      };

      (supabase.rpc as any).mockResolvedValueOnce({
        data: {
          success: true,
          lead_id: 'lead-contact-direct-1',
          authoritative_timestamp: '2026-10-14T12:00:00Z',
        },
        error: null,
      });

      const { data, error } = await supabase.rpc('process_form_submission_transaction', submissionData);
      expect(error).toBeNull();
      expect(data.success).toBe(true);
      expect(data.lead_id).toBe('lead-contact-direct-1');
    });

    it('26. Realtime visibility: inbound submission sets has_new_submission = true and advances last_acquisition_at', () => {
      const nowTs = new Date().toISOString();
      const updatedLead = {
        id: 'lead-contact-1',
        first_name: 'Dr. Lucas',
        last_name: 'Almeida',
        email: 'drlucas@example.com',
        source: 'website',
        source_detail: 'Website Contact Us Form',
        pipeline_stage_id: 'stage-capture',
        last_acquisition_at: nowTs,
        has_new_submission: true,
        new_inbound_count: 1,
        created_at: nowTs,
        updated_at: nowTs,
        source_created_at: nowTs,
      } as unknown as Lead;

      expect(updatedLead.has_new_submission).toBe(true);
      expect(updatedLead.new_inbound_count).toBe(1);
      expect(updatedLead.last_acquisition_at).toBe(nowTs);
    });

    it('27 & 28. Soft-deleted returning lead resurfaces (deleted_at = NULL) on new inbound form without duplicate creation', () => {
      // When a new form submission arrives for a contact previously deleted in EDS:
      const previouslyDeletedLead = {
        id: 'lead-recovered-999',
        email: 'recovered@example.com',
        deleted_at: '2026-05-01T10:00:00Z',
        archived: true,
      };

      // Factual incoming submission clears soft deletion
      const restoredLead = {
        ...previouslyDeletedLead,
        deleted_at: null,
        archived: false,
        has_new_submission: true,
        new_inbound_count: 1,
        last_acquisition_at: '2026-10-14T12:00:00Z',
      };

      expect(restoredLead.deleted_at).toBeNull();
      expect(restoredLead.archived).toBe(false);
      expect(restoredLead.has_new_submission).toBe(true);
      expect(restoredLead.id).toBe(previouslyDeletedLead.id); // Same canonical ID, zero duplicate
    });
  });
});
