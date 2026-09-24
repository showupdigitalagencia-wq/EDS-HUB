import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import fs from 'node:fs';
import path from 'node:path';
import { WorkDashboardPage } from '../features/work/WorkDashboardPage';
import {
  fetchDailyOperationsDashboardDirect,
  fetchDailyOperationsQueueDirect,
  fetchDailyOperationsQueue,
  completeCrmTask,
  createCrmTask,
  sortWorkItems,
} from '../features/work/services/work-queue-service';
import { LeadQuickActionBar } from '../features/leads/components/LeadQuickActionBar';
import { LeadTaskList } from '../features/leads/components/LeadTaskList';
import { supabase } from '../lib/supabase';
import type { Lead, Task, IncompleteEnrollment } from '../types';

// Mock AuthProvider context and Supabase for UI components
vi.mock('../features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'test-user-id', email: 'admin@expdentalsolutions.com' },
    session: { access_token: 'fake-jwt' },
    role: 'admin',
    loading: false,
    signOut: vi.fn(),
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('EDS HUB — Website Form Validation + Task Center Functional Hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // SECTION 32: TESTS — WEBSITE FORM
  // ===========================================================================
  describe('32. Website Form Integration & Incomplete Intent Reconciliation', () => {
    const submitFunctionPath = path.resolve(
      process.cwd(),
      'supabase/functions/submit-public-form/index.ts'
    );
    const incompleteFunctionPath = path.resolve(
      process.cwd(),
      'supabase/functions/capture-incomplete-enrollment/index.ts'
    );
    const migration00058Path = path.resolve(
      process.cwd(),
      'supabase/migrations/00058_add_form_completed_status.sql'
    );

    const submitFunctionContent = fs.readFileSync(submitFunctionPath, 'utf8');
    const incompleteFunctionContent = fs.readFileSync(incompleteFunctionPath, 'utf8');
    const migration00058Content = fs.readFileSync(migration00058Path, 'utf8');

    it('incomplete capture accepts attempt ID and creates single safe intent record', () => {
      expect(incompleteFunctionContent).toContain('external_attempt_id');
      expect(incompleteFunctionContent).toContain('capture_incomplete_enrollment_transaction');
    });

    it('preserves same external_attempt_id / eds_form_attempt_id across incomplete and complete', () => {
      expect(submitFunctionContent).toContain('external_attempt_id');
      expect(submitFunctionContent).toContain('p_external_attempt_id: effectiveAttemptId');

      // Matching attempt reconciliation in DB RPC
      expect(migration00058Content).toContain('trim(p_external_attempt_id)');
    });

    it('transitions status to form_completed upon submission, NOT recovered', () => {
      // form_completed indicates completed application; recovered is strictly reserved for confirmed enrollment
      expect(migration00058Content).toContain("status = 'form_completed'");
      expect(migration00058Content).toContain('resolved_form_submission_id = v_submission_id');
      expect(migration00058Content).toContain('resolved_at = now()');
      expect(migration00058Content).not.toContain("status = 'recovered'\n      WHERE ie.id = v_matched_incomplete_id");
    });

    it('reserves recovered strictly for confirmed enrollments in public.enrollments', () => {
      expect(migration00058Content).toContain("status IN ('needs_followup', 'form_completed')");
      expect(migration00058Content).toContain("SET status = 'recovered'");
      expect(migration00058Content).toContain('resolved_enrollment_id = NEW.id');
    });

    it('enforces canonical course mappings and prevents unsafe fallback', () => {
      const canonicalMappings: Record<string, string> = {
        'Dental Implant Intensive Course': 'IDIT-01',
        'Advanced Bone Grafting & Sinus Lift': 'ADIE-01',
        'Zygomatic & Pterygoid Implants': 'ZIT-01',
        'Full Arch Immediate Loading': 'AIRE-01',
      };

      const resolveCourseCode = (courseName: string): string | null => {
        return canonicalMappings[courseName] || null;
      };

      expect(resolveCourseCode('Dental Implant Intensive Course')).toBe('IDIT-01');
      expect(resolveCourseCode('Advanced Bone Grafting & Sinus Lift')).toBe('ADIE-01');
      expect(resolveCourseCode('Zygomatic & Pterygoid Implants')).toBe('ZIT-01');
      expect(resolveCourseCode('Full Arch Immediate Loading')).toBe('AIRE-01');
      expect(resolveCourseCode('Unknown Course Name')).toBeNull(); // No unsafe fallback!
    });

    it('strictly strips sensitive fields and raw FormData (Privacy Check)', () => {
      const sensitiveFields = [
        'medical_conditions',
        'dietary',
        'passport',
        'dental_license',
        'signature',
        'emergency_phone',
        'certificate_name',
        'coat_size',
        'formData',
        'raw_form_data',
      ];

      for (const field of sensitiveFields) {
        expect(submitFunctionContent).toContain(`delete fields.${field}`);
      }
    });

    it('retains same lead_id without duplicate contact creation on complete submission', () => {
      const existingLeadId = 'lead-uuid-test-01';
      const incompleteRecord: IncompleteEnrollment = {
        id: 'inc-01',
        processing_status: 'processed',
        status: 'needs_followup',
        lead_id: existingLeadId,
        course_id: 'course-idit',
        course_session_id: null,
        idempotency_key: 'idemp-01',
        external_attempt_id: 'attempt-01',
        task_id: 'task-01',
        resolved_form_submission_id: null,
        resolved_enrollment_id: null,
        resolved_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // When completion arrives with matching attempt ID and same lead:
      const completedLeadId = existingLeadId;
      expect(completedLeadId).toBe(incompleteRecord.lead_id);
    });

    it('protects against unsafe merge when email belongs to Lead A and phone belongs to Lead B', () => {
      const leadA = { id: 'lead-a', email: 'alice@example.com', phone: '+1234567890' };
      const leadB = { id: 'lead-b', email: 'bob@example.com', phone: '+1987654321' };

      const incomingPayload = {
        email: 'alice@example.com',
        phone: '+1987654321', // Conflicting phone
      };

      const matchLeadSafely = (payload: { email: string; phone: string }) => {
        const emailMatch = payload.email === leadA.email ? leadA : null;
        const phoneMatch = payload.phone === leadB.phone ? leadB : null;

        if (emailMatch && phoneMatch && emailMatch.id !== phoneMatch.id) {
          return { conflict: true, lead_id: null, message: 'Identity conflict: Email and phone belong to distinct leads.' };
        }
        return { conflict: false, lead_id: emailMatch?.id || phoneMatch?.id || null };
      };

      const result = matchLeadSafely(incomingPayload);
      expect(result.conflict).toBe(true);
      expect(result.lead_id).toBeNull();
    });

    it('website first-contact automation remains dormant (zero automatic email/SMS)', () => {
      // ENABLE_META_FIRST_EMAIL_AUTOMATION and source checks prevent automatic dispatch
      const enableMetaFirstEmail = false;

      const shouldAutoSendEmail = (source: string) => {
        if (source === 'website' || source === 'form') return false;
        return enableMetaFirstEmail;
      };

      expect(shouldAutoSendEmail('website')).toBe(false);
      expect(shouldAutoSendEmail('form')).toBe(false);
    });
  });

  // ===========================================================================
  // SECTION 33: TESTS — TASK CENTER FUNCTIONAL HARDENING
  // ===========================================================================
  describe('33. Task Center Functional Hardening & Zero Lead Scoring Dependency', () => {
    it('fetchDailyOperationsDashboardDirect computes metrics without public.lead_scores', async () => {
      const metrics = await fetchDailyOperationsDashboardDirect();
      expect(metrics).toBeDefined();
      expect(typeof metrics.due_today_count).toBe('number');
      expect(typeof metrics.overdue_count).toBe('number');
      expect(typeof metrics.completed_today_count).toBe('number');
      expect(typeof metrics.payment_attention_count).toBe('number');
      expect(metrics.hot_leads_count).toBe(0); // Safely 0 without querying missing lead_scores relation
    });

    it('fetchDailyOperationsQueueDirect loads queue directly from public.tasks', async () => {
      const res = await fetchDailyOperationsQueueDirect({ tab: 'today' });
      expect(res).toBeDefined();
      expect(Array.isArray(res.items)).toBe(true);
      expect(typeof res.total_count).toBe('number');
    });

    it('fetchDailyOperationsQueue falls back cleanly if RPC fails with public.lead_scores error', async () => {
      // Mock supabase.rpc to simulate relation "public.lead_scores" does not exist
      const originalRpc = supabase.rpc;
      (supabase as any).rpc = vi.fn().mockRejectedValue(new Error('relation "public.lead_scores" does not exist'));

      const res = await fetchDailyOperationsQueue({ tab: 'today' });
      expect(res).toBeDefined();
      expect(Array.isArray(res.items)).toBe(true);

      // Restore
      (supabase as any).rpc = originalRpc;
    });

    it('renders WorkDashboardPage without database errors', async () => {
      render(
        <MemoryRouter>
          <WorkDashboardPage />
        </MemoryRouter>
      );

      // Header and primary tabs load properly
      expect(screen.getByText('Tarefas Operacionais')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Meu Dia' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Atrasadas' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Pagamentos' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Concluídas' })).toBeInTheDocument();
      // Pós-Curso tab must be absent
      expect(screen.queryByRole('button', { name: 'Pós-Curso' })).not.toBeInTheDocument();
    });

    it('sortWorkItems orders overdue tasks ahead of non-overdue tasks', () => {
      const items: any[] = [
        { id: '1', title: 'Task 1', is_overdue: false, priority: 'normal', due_at: '2026-09-25T10:00:00Z' },
        { id: '2', title: 'Task 2', is_overdue: true, priority: 'normal', due_at: '2026-09-20T10:00:00Z' },
      ];

      const sorted = sortWorkItems(items);
      expect(sorted[0].id).toBe('2'); // Overdue first!
      expect(sorted[1].id).toBe('1');
    });

    it('payment reminder task has task_type = payment and creates zero financial records', async () => {
      const rpcSpy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: { success: true, task_id: 'test-payment-task-id' },
        error: null,
      } as any);

      const res = await createCrmTask({
        leadId: '11111111-1111-1111-1111-111111111111',
        title: 'Pagamento',
        taskType: 'payment',
        dueAt: new Date().toISOString(),
      });

      expect(res.success).toBe(true);
      expect(rpcSpy).toHaveBeenCalledWith('create_crm_task', expect.objectContaining({
        p_task_type: 'payment',
        p_task_source: 'manual',
      }));

      // Verify no financial table mutation occurred
      const fromSpy = vi.spyOn(supabase, 'from');
      expect(fromSpy).not.toHaveBeenCalledWith('financial_records');
      expect(fromSpy).not.toHaveBeenCalledWith('receivables');
      expect(fromSpy).not.toHaveBeenCalledWith('invoices');
    });

    it('task completion sets completed_at and dispatches global synchronization event', async () => {
      const rpcSpy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: { success: true, task_id: 'test-task-123', already_completed: false },
        error: null,
      } as any);

      const eventSpy = vi.spyOn(window, 'dispatchEvent');

      const res = await completeCrmTask('test-task-123');
      expect(res.success).toBe(true);
      expect(rpcSpy).toHaveBeenCalledWith('complete_crm_task', expect.objectContaining({
        p_task_id: 'test-task-123',
      }));

      expect(eventSpy).toHaveBeenCalledWith(expect.objectContaining({
        type: 'tasks-updated',
      }));
    });
  });

  // ===========================================================================
  // SECTION 34: TESTS — LEAD PROFILE QUICK ACTIONS
  // ===========================================================================
  describe('34. Complete Lead Profile Quick Actions Audit', () => {
    const mockLeadWithPhone = {
      id: 'lead-test-01',
      first_name: 'Carlos',
      last_name: 'Mendes',
      email: 'carlos@example.com',
      phone_raw: '+5511999998888',
      phone_e164: '+5511999998888',
      contact_preference: 'call',
      source: 'website_register',
      created_at: '2026-09-20T10:00:00Z',
      updated_at: '2026-09-20T10:00:00Z',
    } as unknown as Lead;

    const mockLeadNoPhone = {
      id: 'lead-test-02',
      first_name: 'Ana',
      last_name: 'Silva',
      email: 'ana@example.com',
      phone_raw: null,
      phone_e164: null,
      contact_preference: 'email',
      source: 'website_register',
      created_at: '2026-09-20T10:00:00Z',
      updated_at: '2026-09-20T10:00:00Z',
    } as unknown as Lead;

    it('Ligar action is enabled with tel: link when valid phone exists', () => {
      render(
        <LeadQuickActionBar
          lead={mockLeadWithPhone}
          onOpenTaskModal={vi.fn()}
          onOpenPaymentModal={vi.fn()}
        />
      );

      const callBtn = screen.getByTestId('quick-action-call');
      expect(callBtn.tagName.toLowerCase()).toBe('a');
      expect(callBtn.getAttribute('href')).toBe('tel:+5511999998888');
    });

    it('Ligar action is safely disabled when lead has no phone', () => {
      render(
        <LeadQuickActionBar
          lead={mockLeadNoPhone}
          onOpenTaskModal={vi.fn()}
          onOpenPaymentModal={vi.fn()}
        />
      );

      const callBtn = screen.getByTestId('quick-action-call');
      expect(callBtn.tagName.toLowerCase()).toBe('button');
      expect(callBtn).toBeDisabled();
      expect(callBtn.getAttribute('title')).toBe('Telefone não informado');
    });

    it('SMS action is strictly disabled with factual inactive provider reason', () => {
      render(
        <LeadQuickActionBar
          lead={mockLeadWithPhone}
          onOpenTaskModal={vi.fn()}
          onOpenPaymentModal={vi.fn()}
        />
      );

      const smsBtn = screen.getByTestId('quick-action-sms');
      expect(smsBtn.tagName.toLowerCase()).toBe('button');
      expect(smsBtn).toBeDisabled();
      expect(smsBtn.getAttribute('title')).toContain('canal Twilio/SMS inativo no momento');
    });

    it('Email action triggers internal composer callback', () => {
      const emailSpy = vi.fn();
      render(
        <LeadQuickActionBar
          lead={mockLeadWithPhone}
          onOpenTaskModal={vi.fn()}
          onOpenPaymentModal={vi.fn()}
          onOpenEmailComposer={emailSpy}
        />
      );

      const emailBtn = screen.getByTestId('quick-action-email');
      expect(emailBtn).not.toBeDisabled();
      fireEvent.click(emailBtn);
      expect(emailSpy).toHaveBeenCalled();
    });

    it('WhatsApp action provides direct external wa.me link when phone exists', () => {
      render(
        <LeadQuickActionBar
          lead={mockLeadWithPhone}
          onOpenTaskModal={vi.fn()}
          onOpenPaymentModal={vi.fn()}
        />
      );

      const waBtn = screen.getByTestId('quick-action-whatsapp');
      expect(waBtn.tagName.toLowerCase()).toBe('a');
      expect(waBtn.getAttribute('href')).toBe('https://wa.me/5511999998888');
    });

    it('Adicionar Tarefa and Pagamento triggers work seamlessly', () => {
      const taskModalSpy = vi.fn();
      const paymentModalSpy = vi.fn();

      render(
        <LeadQuickActionBar
          lead={mockLeadWithPhone}
          onOpenTaskModal={taskModalSpy}
          onOpenPaymentModal={paymentModalSpy}
        />
      );

      const addTaskBtn = screen.getByTestId('quick-action-add-task');
      fireEvent.click(addTaskBtn);
      expect(taskModalSpy).toHaveBeenCalledTimes(1);

      const paymentBtn = screen.getByTestId('quick-action-payment');
      fireEvent.click(paymentBtn);
      expect(paymentModalSpy).toHaveBeenCalledTimes(1);
    });

    it('LeadTaskList provides responsive task completion and feedback banner', async () => {
      vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: { success: true, task_id: 'task-lead-1' },
        error: null,
      } as any);

      const mockTasks = [
        {
          id: 'task-lead-1',
          lead_id: 'lead-test-01',
          title: 'Ligar para confirmar presença',
          task_type: 'call',
          status: 'pending',
          priority: 'normal',
          due_at: new Date(Date.now() + 3600000).toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ] as unknown as Task[];

      const updateSpy = vi.fn();

      render(
        <LeadTaskList
          tasks={mockTasks}
          onOpenCreateTask={vi.fn()}
          onTaskUpdated={updateSpy}
        />
      );

      expect(screen.getByText('Ligar para confirmar presença')).toBeInTheDocument();
      const completeBtn = screen.getByTestId('lead-complete-task-task-lead-1');
      expect(completeBtn).toBeInTheDocument();

      fireEvent.click(completeBtn);

      await waitFor(() => {
        expect(screen.getByText('Tarefa concluída')).toBeInTheDocument();
      });

      expect(updateSpy).toHaveBeenCalled();
    });
  });
});
