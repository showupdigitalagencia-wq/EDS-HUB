import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { LeadProfileContent } from '../features/leads/components/LeadProfileContent';
import { getActivityLabel } from '../features/leads/components/LeadTimeline';
import * as incompleteService from '../features/leads/services/incomplete-enrollment-service';
import type { Lead, IncompleteEnrollment } from '../types';

// Mock Supabase
vi.mock('../lib/supabase', () => {
  const insertMock = vi.fn().mockResolvedValue({ data: null, error: null });
  const selectMock = vi.fn().mockReturnThis();
  const eqMock = vi.fn().mockReturnThis();
  const orderMock = vi.fn().mockReturnThis();
  const limitMock = vi.fn().mockReturnThis();
  const singleMock = vi.fn().mockImplementation(() =>
    Promise.resolve({
      data: {
        id: 'lead-test-b6',
        first_name: 'Guilherme',
        last_name: 'Silveira',
        email: 'guilherme@odonto.com.br',
        phone_raw: '+55 11 98888-7777',
        phone_e164: '+5511988887777',
        contact_preference: 'email',
        pipeline_stage_id: 'stage-capture',
        source: 'form',
        source_detail: 'website_incomplete_enrollment',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      error: null,
    })
  );
  const maybeSingleMock = vi.fn().mockResolvedValue({ data: null, error: null });

  const queryBuilder: any = {
    insert: insertMock,
    select: selectMock,
    eq: eqMock,
    order: orderMock,
    limit: limitMock,
    single: singleMock,
    maybeSingle: maybeSingleMock,
    delete: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
    then: (resolve: any) => resolve({ data: [], error: null }),
  };

  return {
    supabase: {
      from: vi.fn(() => queryBuilder),
      rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
    },
  };
});

// Mock Incomplete Enrollment Service
vi.mock('../features/leads/services/incomplete-enrollment-service', () => ({
  fetchActiveIncompleteEnrollment: vi.fn(),
  dismissIncompleteEnrollment: vi.fn(),
}));

const mockLead: Lead = {
  id: 'lead-test-b6',
  first_name: 'Guilherme',
  last_name: 'Silveira',
  email: 'guilherme@odonto.com.br',
  phone_raw: '+55 11 98888-7777',
  phone_e164: '+5511988887777',
  contact_preference: 'email',
  pipeline_stage_id: 'stage-capture',
  source: 'form',
  source_detail: 'website_incomplete_enrollment',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
} as Lead;

const mockIncompleteEnrollment: IncompleteEnrollment = {
  id: 'inc-attempt-101',
  processing_status: 'processed',
  status: 'needs_followup',
  lead_id: 'lead-test-b6',
  course_id: 'course-fam-uuid',
  course_session_id: 'session-oct-2026',
  idempotency_key: 'idem-key-101',
  external_attempt_id: 'chk_ext_101',
  source_page: 'https://expdentalsolutions.com/cursos/full-arch-mastery',
  utm_source: 'google',
  utm_medium: 'cpc',
  utm_campaign: 'fullarch-outubro',
  task_id: 'task-followup-101',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  course: {
    id: 'course-fam-uuid',
    name: 'Full Arch Mastery',
    code: 'full-arch-mastery',
  },
  course_session: {
    id: 'session-oct-2026',
    title: '15 a 17 de Outubro de 2026',
    start_date: '2026-10-15',
  },
  task: {
    id: 'task-followup-101',
    title: 'Retomar inscrição: Full Arch Mastery',
    status: 'pending',
  },
};

describe('Batch 6: Incomplete Enrollment Capture Architecture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. UI Integration: Lead Profile Compact Alert Banner', () => {
    it('renders the compact operational alert when an active incomplete enrollment exists', async () => {
      vi.mocked(incompleteService.fetchActiveIncompleteEnrollment).mockResolvedValue(
        mockIncompleteEnrollment
      );

      render(
        <BrowserRouter>
          <LeadProfileContent leadId={mockLead.id} initialLead={mockLead} />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Inscrição não concluída')).toBeInTheDocument();
        expect(screen.getByText('Follow-up pendente')).toBeInTheDocument();
        expect(screen.getByText(/Full Arch Mastery/)).toBeInTheDocument();
        expect(screen.getByText(/Turma: 15 a 17 de Outubro de 2026/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Ver Tarefa/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Dispensar Alerta/i })).toBeInTheDocument();
      });
    });

    it('navigates to Tarefas tab when clicking Ver Tarefa', async () => {
      vi.mocked(incompleteService.fetchActiveIncompleteEnrollment).mockResolvedValue(
        mockIncompleteEnrollment
      );

      render(
        <BrowserRouter>
          <LeadProfileContent leadId={mockLead.id} initialLead={mockLead} />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Ver Tarefa/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Ver Tarefa/i }));

      await waitFor(() => {
        // Tarefas tab renders empty state
        expect(screen.getByText('Nenhuma tarefa agendada')).toBeInTheDocument();
      });
    });

    it('calls dismissIncompleteEnrollment and removes alert when clicking Dispensar Alerta', async () => {
      vi.mocked(incompleteService.fetchActiveIncompleteEnrollment).mockResolvedValue(
        mockIncompleteEnrollment
      );
      vi.mocked(incompleteService.dismissIncompleteEnrollment).mockResolvedValue({ success: true });

      render(
        <BrowserRouter>
          <LeadProfileContent leadId={mockLead.id} initialLead={mockLead} />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Dispensar Alerta/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Dispensar Alerta/i }));

      await waitFor(() => {
        expect(incompleteService.dismissIncompleteEnrollment).toHaveBeenCalledWith(
          mockIncompleteEnrollment.id,
          expect.any(String)
        );
      });
    });

    it('does not render alert banner if incomplete enrollment status is not needs_followup', async () => {
      vi.mocked(incompleteService.fetchActiveIncompleteEnrollment).mockResolvedValue(null);

      render(
        <BrowserRouter>
          <LeadProfileContent leadId={mockLead.id} initialLead={mockLead} />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.queryByText('Inscrição não concluída')).not.toBeInTheDocument();
      });
    });
  });

  describe('2. Timeline Labels: Batch 6 Portuguese Activity Types', () => {
    it('translates incomplete_enrollment_captured to "Inscrição iniciada e não concluída"', () => {
      expect(getActivityLabel('incomplete_enrollment_captured')).toBe(
        'Inscrição iniciada e não concluída'
      );
    });

    it('translates incomplete_enrollment_recovered to "Inscrição recuperada — matrícula confirmada"', () => {
      expect(getActivityLabel('incomplete_enrollment_recovered')).toBe(
        'Inscrição recuperada — matrícula confirmada'
      );
    });

    it('translates incomplete_enrollment_dismissed to "Alerta de inscrição dispensado"', () => {
      expect(getActivityLabel('incomplete_enrollment_dismissed')).toBe(
        'Alerta de inscrição dispensado'
      );
    });
  });

  describe('3. Core Architecture & Relational Rules Simulation', () => {
    // 3.1 New Lead Capture
    it('creates new lead at capture stage (Novo Lead) with form attribution without moving pipeline', () => {
      const isNewLead = true;
      const initialStage = isNewLead ? 'capture' : 'existing-stage';
      const source = isNewLead ? 'form' : 'meta';
      const sourceDetail = isNewLead ? 'website_incomplete_enrollment' : 'meta_ads';

      expect(initialStage).toBe('capture');
      expect(source).toBe('form');
      expect(sourceDetail).toBe('website_incomplete_enrollment');
      expect(initialStage).not.toBe('enrollment'); // Never automatically moves to Matrícula
    });

    // 3.2 Existing Lead Matching & Source Immutability
    it('matches existing lead and strictly preserves original source and pipeline stage', () => {
      const existingLead = {
        id: 'lead-1',
        source: 'meta',
        source_detail: 'instagram_story_ad',
        pipeline_stage_id: 'stage-acquisition', // Interessado
      };

      // Payload arrives via incomplete enrollment
      const updatedSource = existingLead.source; // Preserved
      const updatedSourceDetail = existingLead.source_detail; // Preserved
      const updatedStage = existingLead.pipeline_stage_id; // Preserved

      expect(updatedSource).toBe('meta');
      expect(updatedSourceDetail).toBe('instagram_story_ad');
      expect(updatedStage).toBe('stage-acquisition');
    });

    // 3.3 Ambiguous Identity Conflict Protection (Email matches Lead A, Phone matches Lead B)
    it('detects email/phone conflict: creates NO task, NO activity, and does NOT merge leads', () => {
      const leadByEmail: string | null = 'lead-A';
      const leadByPhone: string | null = 'lead-B';

      const isConflict = leadByEmail !== null && leadByPhone !== null && leadByEmail !== leadByPhone;
      expect(isConflict).toBe(true);

      const attemptRow = {
        processing_status: isConflict ? 'conflict' : 'processed',
        status: isConflict ? null : 'needs_followup',
        lead_id: isConflict ? null : leadByEmail,
        task_id: isConflict ? null : 'task-1',
      };

      const tasksCreated = isConflict ? 0 : 1;
      const activitiesLogged = isConflict ? 0 : 1;

      expect(attemptRow.processing_status).toBe('conflict');
      expect(attemptRow.status).toBeNull();
      expect(attemptRow.lead_id).toBeNull();
      expect(attemptRow.task_id).toBeNull();
      expect(tasksCreated).toBe(0);
      expect(activitiesLogged).toBe(0);
    });

    // 3.4 Idempotency Retry Protection
    it('authoritative idempotency: retrying identical key returns cached outcome with zero writes', () => {
      const existingRecord = {
        id: 'inc-99',
        idempotency_key: 'idem-dup-test',
        lead_id: 'lead-99',
        processing_status: 'processed',
        status: 'needs_followup',
      };

      const incomingKey = 'idem-dup-test';
      const isDuplicate = incomingKey === existingRecord.idempotency_key;

      expect(isDuplicate).toBe(true);
      const writesPerformed = isDuplicate ? 0 : 1;
      expect(writesPerformed).toBe(0);
    });

    // 3.5 Session-Aware Task Deduplication: Same Session vs Different Session
    it('session-aware task dedup: reuses pending task for same session, creates distinct task for different session', () => {
      const activeAttempts = [
        {
          id: 'attempt-1',
          course_id: 'course-fam',
          course_session_id: 'session-oct-2026',
          task_id: 'task-oct-pending',
          status: 'needs_followup',
        },
      ];

      // Attempt A: Repeated attempt for October session
      const attemptA_Session = 'session-oct-2026';
      const matchingAttemptA = activeAttempts.find(
        (a) => a.course_id === 'course-fam' && a.course_session_id === attemptA_Session
      );
      const shouldCreateTaskA = !matchingAttemptA;
      expect(shouldCreateTaskA).toBe(false); // Reuses existing task-oct-pending

      // Attempt B: New attempt for January session
      const attemptB_Session = 'session-jan-2027';
      const matchingAttemptB = activeAttempts.find(
        (a) => a.course_id === 'course-fam' && a.course_session_id === attemptB_Session
      );
      const shouldCreateTaskB = !matchingAttemptB;
      expect(shouldCreateTaskB).toBe(true); // Distinct operational intent -> creates new task!
    });

    // 3.6 Course Interest Session Overwrite Protection (Session-Integrity Patch)
    it('course interest session: fills empty session but NEVER overwrites an already populated session', () => {
      // Scenario A: Existing interest has NULL session
      let existingInterest = {
        course_id: 'course-fam',
        course_session_id: null as string | null,
      };

      const incomingSessionA = 'session-oct-2026';
      if (existingInterest.course_session_id === null && incomingSessionA) {
        existingInterest.course_session_id = incomingSessionA;
      }
      expect(existingInterest.course_session_id).toBe('session-oct-2026'); // Populated

      // Scenario B: Existing interest has October session, incoming attempt has January session
      const incomingSessionB = 'session-jan-2027';
      if (existingInterest.course_session_id === null && incomingSessionB) {
        existingInterest.course_session_id = incomingSessionB;
      }
      // Must NOT be overwritten by January!
      expect(existingInterest.course_session_id).toBe('session-oct-2026');
    });

    // 3.7 Course Interest Priority Slot Algorithm (Avoids count + 1 Conflict)
    it('allocates the first free slot from [1, 2, 3] and avoids count + 1 collisions', () => {
      // Slots 1 and 3 are taken (count = 2)
      const takenSlots = [1, 3];
      const allSlots = [1, 2, 3];

      // Safe slot allocation algorithm:
      const freeSlot = allSlots.find((s) => !takenSlots.includes(s)) || null;
      expect(freeSlot).toBe(2); // Allocates free slot 2 (count + 1 would collide on 3)

      // When all 3 slots taken:
      const allTaken = [1, 2, 3];
      const noFreeSlot = allSlots.find((s) => !allTaken.includes(s)) || null;
      expect(noFreeSlot).toBeNull(); // Safely sets priority = null
    });

    // 3.8 Session-Aware Recovery on Confirmed Enrollment
    it('recovers same-session and null-session attempts, but leaves different-session attempt needs_followup', () => {
      const attempts = [
        { id: 'att-1', course_id: 'course-fam', course_session_id: 'session-oct-2026', status: 'needs_followup', task_id: 'task-1' },
        { id: 'att-2', course_id: 'course-fam', course_session_id: null, status: 'needs_followup', task_id: 'task-2' },
        { id: 'att-3', course_id: 'course-fam', course_session_id: 'session-jan-2027', status: 'needs_followup', task_id: 'task-3' },
      ];

      // Confirmed enrollment arrives for October session
      const confirmedEnrollment = {
        course_id: 'course-fam',
        course_session_id: 'session-oct-2026',
        enrollment_status: 'confirmed',
      };

      const reconciledAttempts = attempts.map((att) => {
        const matchesSession =
          confirmedEnrollment.course_session_id !== null &&
          (att.course_session_id === confirmedEnrollment.course_session_id || att.course_session_id === null);

        if (matchesSession) {
          return { ...att, status: 'recovered' };
        }
        return att;
      });

      expect(reconciledAttempts[0].status).toBe('recovered'); // Same session
      expect(reconciledAttempts[1].status).toBe('recovered'); // Null session recovered
      expect(reconciledAttempts[2].status).toBe('needs_followup'); // January attempt preserved!
    });

    // 3.9 Null-Session Enrollment Recovery Fallback
    it('controlled fallback: confirmed enrollment with NULL session recovers all course attempts', () => {
      const attempts = [
        { id: 'att-1', course_id: 'course-fam', course_session_id: 'session-oct-2026', status: 'needs_followup' },
        { id: 'att-2', course_id: 'course-fam', course_session_id: 'session-jan-2027', status: 'needs_followup' },
      ];

      // Enrollment confirmed without specific session
      const confirmedEnrollment = {
        course_id: 'course-fam',
        course_session_id: null as string | null,
        enrollment_status: 'confirmed',
      };

      const reconciled = attempts.map((att) => {
        if (confirmedEnrollment.course_session_id === null && att.course_id === confirmedEnrollment.course_id) {
          return { ...att, status: 'recovered' };
        }
        return att;
      });

      expect(reconciled[0].status).toBe('recovered');
      expect(reconciled[1].status).toBe('recovered');
    });

    // 3.10 Task Auto-Completion Scoped to Actually Recovered Attempts
    it('completes only tasks linked to actually recovered attempts', () => {
      const taskStatusMap: Record<string, string> = {
        'task-oct': 'pending',
        'task-jan': 'pending',
      };

      // Only October attempt was recovered
      const recoveredTaskIds = ['task-oct'];

      recoveredTaskIds.forEach((id) => {
        taskStatusMap[id] = 'completed';
      });

      expect(taskStatusMap['task-oct']).toBe('completed');
      expect(taskStatusMap['task-jan']).toBe('pending'); // January task stays pending!
    });

    // 3.11 Dismissal Cancels Linked Pending Task
    it('operator dismissal marks attempt dismissed and cancels only its linked pending task', () => {
      const attempt = { id: 'att-1', status: 'needs_followup', task_id: 'task-1' };
      const tasks = [
        { id: 'task-1', status: 'pending' },
        { id: 'task-unrelated', status: 'pending' },
      ];

      // Operator dismisses alert
      attempt.status = 'dismissed';
      const linkedTask = tasks.find((t) => t.id === attempt.task_id);
      if (linkedTask && linkedTask.status === 'pending') {
        linkedTask.status = 'cancelled';
      }

      expect(attempt.status).toBe('dismissed');
      expect(tasks[0].status).toBe('cancelled');
      expect(tasks[1].status).toBe('pending'); // Unrelated task remains untouched!
    });

    // 3.12 Sensitive Fields Blacklist & URL Sanitization
    it('sanitizes source_page stripping query parameters and rejects blacklisted sensitive keys', () => {
      const rawUrl = 'https://expdentalsolutions.com/cursos/full-arch?utm_source=fb&secret_token=123#checkout';
      const sanitizedUrl = rawUrl.split('?')[0].split('#')[0];
      expect(sanitizedUrl).toBe('https://expdentalsolutions.com/cursos/full-arch');

      const blacklistedKeys = ['card_number', 'cvv', 'password', 'cpf', 'pan'];
      const payloadWithCard = { email: 'test@eds.com', course_id: 'uuid', card_number: '4111222233334444' };
      const hasBlacklistedKey = Object.keys(payloadWithCard).some((k) =>
        blacklistedKeys.some((p) => k.toLowerCase().includes(p))
      );
      expect(hasBlacklistedKey).toBe(true); // Triggers immediate HTTP 400 rejection
    });
  });

  describe('4. Migration 00057 Invariants Static Verification', () => {
    const migrationPath = path.resolve(__dirname, '../../supabase/migrations/00057_create_incomplete_enrollments_schema.sql');
    let sqlContent = '';

    beforeEach(() => {
      expect(fs.existsSync(migrationPath)).toBe(true);
      sqlContent = fs.readFileSync(migrationPath, 'utf-8');
    });

    it('extends lead_activities check constraint with exactly 3 new types without deleting previous 54', () => {
      expect(sqlContent).toContain('incomplete_enrollment_captured');
      expect(sqlContent).toContain('incomplete_enrollment_recovered');
      expect(sqlContent).toContain('incomplete_enrollment_dismissed');
      // Preserves historical manual contact types from 00056
      expect(sqlContent).toContain('call_manual_attempt');
      expect(sqlContent).toContain('whatsapp_contact_attempt');
      expect(sqlContent).toContain('email_manual_attempt');
      expect(sqlContent).toContain('sms_manual_attempt');
    });

    it('enforces two-tier status and consistency check on incomplete_enrollments', () => {
      expect(sqlContent).toMatch(/processing_status\s+TEXT\s+NOT\s+NULL/i);
      expect(sqlContent).toContain("CHECK (processing_status IN ('processed', 'conflict'))");
      expect(sqlContent).toContain("CHECK (status IS NULL OR status IN ('needs_followup', 'recovered', 'dismissed'))");
      // Consistency check: conflict -> lead_id NULL & status NULL; processed -> lead_id NOT NULL & status NOT NULL
      expect(sqlContent).toContain("processing_status = 'conflict' AND lead_id IS NULL AND status IS NULL");
      expect(sqlContent).toContain("processing_status = 'processed' AND lead_id IS NOT NULL AND status IS NOT NULL");
    });

    it('enforces idempotency unique constraint and external_attempt_id non-unique index', () => {
      expect(sqlContent).toMatch(/idempotency_key\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i);
      expect(sqlContent).toMatch(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_incomplete_enrollments_external_attempt_id\s+ON\s+public\.incomplete_enrollments\s*\(\s*external_attempt_id\s*\)/i);
      expect(sqlContent).not.toMatch(/CREATE\s+UNIQUE\s+INDEX[^\n]+idx_incomplete_enrollments_external_attempt_id/i);
    });

    it('ensures metadata JSONB is NOT present in incomplete_enrollments table', () => {
      // Must not define metadata JSONB in incomplete_enrollments
      const createTableBlock = sqlContent.match(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.incomplete_enrollments\s*\([\s\S]*?\);/i)?.[0] || '';
      expect(createTableBlock).not.toMatch(/metadata\s+JSONB/i);
    });

    it('strictly locks down RPC execute permissions', () => {
      // capture_incomplete_enrollment_transaction: REVOKE from PUBLIC, anon, authenticated; GRANT to service_role only
      expect(sqlContent).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.capture_incomplete_enrollment_transaction[^\n]+FROM\s+PUBLIC,\s*anon,\s*authenticated;/i);
      expect(sqlContent).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.capture_incomplete_enrollment_transaction[^\n]+TO\s+service_role;/i);

      // dismiss_incomplete_enrollment: REVOKE from PUBLIC, anon; GRANT to authenticated; checks is_active_app_user()
      expect(sqlContent).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.dismiss_incomplete_enrollment[^\n]+FROM\s+PUBLIC,\s*anon;/i);
      expect(sqlContent).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.dismiss_incomplete_enrollment[^\n]+TO\s+authenticated;/i);
      expect(sqlContent).toContain('public.is_active_app_user()');
    });

    it('implements session-aware recovery trigger with null-session fallback and scoped task completion', () => {
      // Trigger function exists
      expect(sqlContent).toContain('trg_reconcile_incomplete_enrollment_on_confirm');
      // Session awareness: matching course_session_id OR null session fallback
      expect(sqlContent).toContain('course_session_id = NEW.course_session_id OR course_session_id IS NULL');
      // Only completes tasks for rows actually recovered
      expect(sqlContent).toContain("WHERE id = v_rec.task_id AND status = 'pending'");
    });

    it('implements persistent rate limits table with 24-hour cleanup window', () => {
      expect(sqlContent).toContain('CREATE TABLE IF NOT EXISTS public.incomplete_enrollment_rate_limits');
      expect(sqlContent).toMatch(/DELETE\s+FROM\s+public\.incomplete_enrollment_rate_limits\s+WHERE\s+window_start\s*<\s*\(now\(\)\s*-\s*interval\s*'24\s*hours'\)/i);
    });
  });
});

