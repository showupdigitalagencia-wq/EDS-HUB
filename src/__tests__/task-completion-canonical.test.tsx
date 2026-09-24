import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { completeCrmTask } from '../features/work/services/work-queue-service';
import { LeadTaskList } from '../features/leads/components/LeadTaskList';
import { WorkDashboardPage } from '../features/work/WorkDashboardPage';
import { WorkItemCard } from '../features/work/components/WorkItemCard';
import { supabase } from '../lib/supabase';
import type { Task, WorkItem } from '../types';

// Mock AuthProvider context and Supabase for UI components
vi.mock('../features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'test-admin-uid-123', email: 'admin@expdentalsolutions.com' },
    session: { access_token: 'valid-test-jwt' },
    appUser: { user_id: 'test-admin-uid-123', email: 'admin@expdentalsolutions.com', is_active: true },
    isAuthorized: true,
    isLoading: false,
    signOut: vi.fn(),
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('EDS HUB — Task Completion Button Canonical Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // 1. CANONICAL SERVICE FUNCTION & MULTI-LAYER BACKEND PERSISTENCE
  // ===========================================================================
  describe('Canonical completeCrmTask Backend Persistence & Fallback', () => {
    it('normalizes task ID by stripping "task:" prefix and trimming whitespace', async () => {
      const rpcSpy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: { success: true, task_id: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d', already_completed: false },
        error: null,
      } as any);

      const res = await completeCrmTask('task:a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d   ');

      expect(res.success).toBe(true);
      expect(res.task_id).toBe('a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d');
      expect(rpcSpy).toHaveBeenCalledWith('complete_crm_task', expect.objectContaining({
        p_task_id: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
      }));
    });

    it('persists completion via canonical RPC and dispatches synchronization events', async () => {
      vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: { success: true, task_id: 'task-uuid-101', already_completed: false },
        error: null,
      } as any);

      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

      const res = await completeCrmTask('task-uuid-101', 'Follow-up completed');

      expect(res.success).toBe(true);
      expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({
        type: 'tasks-updated',
        detail: { taskId: 'task-uuid-101' },
      }));
      expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({
        type: 'lead-updated',
        detail: { taskId: 'task-uuid-101' },
      }));
    });

    it('resiliently falls back to direct public.tasks update when RPC fails', async () => {
      // 1. Simulate RPC error (e.g. PL/pgSQL constraint or RPC unavailable)
      vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: null,
        error: { message: 'Database RPC execution error', code: 'P0001' } as any,
      } as any);

      // 2. Mock direct table update chain
      const mockSelect = vi.fn().mockResolvedValue({
        data: [{
          id: 'fallback-task-uuid',
          lead_id: 'lead-uuid-456',
          title: 'Ligar para confirmar presença',
          status: 'completed',
          completed_at: new Date().toISOString(),
        }],
        error: null,
      });

      const mockEq = vi.fn().mockReturnValue({ select: mockSelect });
      const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });
      const fromSpy = vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
        if (table === 'tasks') {
          return { update: mockUpdate } as any;
        }
        if (table === 'lead_activities') {
          return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) } as any;
        }
        return {} as any;
      });

      const res = await completeCrmTask('fallback-task-uuid');

      expect(res.success).toBe(true);
      expect(res.task_id).toBe('fallback-task-uuid');
      expect(fromSpy).toHaveBeenCalledWith('tasks');
      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
        status: 'completed',
        completed_at: expect.any(String),
        updated_at: expect.any(String),
      }));
      expect(mockEq).toHaveBeenCalledWith('id', 'fallback-task-uuid');
    });

    it('failed completion keeps task pending without optimistic desync', async () => {
      // Both RPC and direct table update fail
      vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: null,
        error: { message: 'RPC failure' } as any,
      } as any);

      const mockSelect = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Database connection refused' },
      });
      const mockEq = vi.fn().mockReturnValue({ select: mockSelect });
      const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });
      vi.spyOn(supabase, 'from').mockReturnValue({ update: mockUpdate } as any);

      await expect(completeCrmTask('unreachable-task')).rejects.toThrow('Database connection refused');
    });
  });

  // ===========================================================================
  // 2. LEAD PROFILE ENTRY POINT (Lead Profile → Tarefas → Marcar como concluída)
  // ===========================================================================
  describe('Lead Profile Entry Point', () => {
    const mockTasks: Task[] = [
      {
        id: 'lead-task-01',
        lead_id: 'lead-111',
        intake_event_id: null,
        task_type: 'call',
        title: 'Ligar para Dr. Roberto',
        description: 'Explicar detalhes do curso de Implantes',
        status: 'pending',
        priority: 'high',
        task_source: 'manual',
        created_by: 'system',
        due_at: '2026-09-20T14:00:00Z', // Overdue
        created_at: '2026-09-18T10:00:00Z',
        updated_at: '2026-09-18T10:00:00Z',
        completed_at: null,
      },
      {
        id: 'lead-task-02',
        lead_id: 'lead-111',
        intake_event_id: null,
        task_type: 'payment',
        title: 'Lembrete de Pagamento Entrada',
        description: null,
        status: 'completed',
        priority: 'normal',
        task_source: 'manual',
        created_by: 'system',
        due_at: null,
        created_at: '2026-09-15T09:00:00Z',
        updated_at: '2026-09-17T12:00:00Z',
        completed_at: '2026-09-17T12:00:00Z',
      },
    ];

    it('renders pending and completed tasks with proper counters', () => {
      render(
        <LeadTaskList
          tasks={mockTasks}
          onOpenCreateTask={vi.fn()}
          onTaskUpdated={vi.fn()}
        />
      );

      // Header shows 1 pending task
      expect(screen.getByText('Tarefas (1)')).toBeInTheDocument();
      expect(screen.getByText('Ligar para Dr. Roberto')).toBeInTheDocument();
      expect(screen.getByText('Atrasada')).toBeInTheDocument();

      // Completed section shows 1 completed task
      expect(screen.getByText('Concluídas (1)')).toBeInTheDocument();
      expect(screen.getByText('Lembrete de Pagamento Entrada')).toBeInTheDocument();
    });

    it('completes task, shows "Tarefa concluída", and invokes onTaskUpdated', async () => {
      vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: { success: true, task_id: 'lead-task-01', already_completed: false },
        error: null,
      } as any);

      const onUpdated = vi.fn();

      render(
        <LeadTaskList
          tasks={mockTasks}
          onOpenCreateTask={vi.fn()}
          onTaskUpdated={onUpdated}
        />
      );

      const completeButton = screen.getByRole('button', { name: /Marcar como concluída/i });
      fireEvent.click(completeButton);

      await waitFor(() => {
        expect(screen.getByText('Tarefa concluída')).toBeInTheDocument();
      });

      expect(onUpdated).toHaveBeenCalledTimes(1);
    });

    it('blocks double-click while task completion is in-flight', async () => {
      let resolveRpc: any;
      const rpcPromise = new Promise((resolve) => {
        resolveRpc = resolve;
      });

      const rpcSpy = vi.spyOn(supabase, 'rpc').mockReturnValue(rpcPromise as any);

      render(
        <LeadTaskList
          tasks={mockTasks}
          onOpenCreateTask={vi.fn()}
          onTaskUpdated={vi.fn()}
        />
      );

      const completeButton = screen.getByRole('button', { name: /Marcar como concluída/i });

      // First click: initiates completion
      fireEvent.click(completeButton);
      expect(screen.getByText('Concluindo...')).toBeInTheDocument();
      expect(completeButton).toBeDisabled();

      // Second click: immediately blocked because button is disabled and state is completing
      fireEvent.click(completeButton);

      expect(rpcSpy).toHaveBeenCalledTimes(1);

      // Resolve in-flight RPC
      resolveRpc({ data: { success: true, task_id: 'lead-task-01' }, error: null });

      await waitFor(() => {
        expect(screen.getByText('Tarefa concluída')).toBeInTheDocument();
      });
    });

    it('shows failure message and keeps task pending if backend completion fails', async () => {
      // Simulate persistent failure
      vi.spyOn(supabase, 'rpc').mockRejectedValue(new Error('Network error'));
      vi.spyOn(supabase, 'from').mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockResolvedValue({ data: null, error: { message: 'Database error' } }),
          }),
        }),
      } as any);

      const onUpdated = vi.fn();

      render(
        <LeadTaskList
          tasks={mockTasks}
          onOpenCreateTask={vi.fn()}
          onTaskUpdated={onUpdated}
        />
      );

      const completeButton = screen.getByRole('button', { name: /Marcar como concluída/i });
      fireEvent.click(completeButton);

      await waitFor(() => {
        expect(screen.getByText('Não foi possível concluir a tarefa.')).toBeInTheDocument();
      });

      // Does NOT trigger refresh optimistically
      expect(onUpdated).not.toHaveBeenCalled();
      // Task remains pending in list
      expect(screen.getByText('Ligar para Dr. Roberto')).toBeInTheDocument();
    });
  });

  // ===========================================================================
  // 3. /WORK DASHBOARD ENTRY POINT (Tarefas /work → task card → Marcar como concluída)
  // ===========================================================================
  describe('/work Dashboard Entry Point', () => {
    const mockWorkItem: WorkItem = {
      id: 'task:work-item-task-777',
      type: 'TASK',
      category: 'today',
      priority: 'high',
      title: 'Follow-up de Matrícula Dr. Silva',
      description: 'Confirmar documentos enviados',
      due_at: '2026-09-24T18:00:00Z',
      is_overdue: false,
      detected_at: '2026-09-24T08:00:00Z',
      lead_id: 'lead-silva-999',
      lead_name: 'Dr. Silva',
      lead_email: 'silva@example.com',
      lead_phone: '+15551234567',
      contact_preference: 'call',
      lead_score: null,
      pipeline_stage: 'Matrícula',
      reason_code: null,
      context_id: 'work-item-task-777',
      context_type: 'task',
      primary_action: {
        type: 'complete_task',
        label: 'Marcar como concluída',
        task_id: 'work-item-task-777',
      },
    };

    it('WorkItemCard normalizes task ID and invokes onCompleteTask without "task:" prefix', () => {
      const onComplete = vi.fn();

      render(
        <MemoryRouter>
          <WorkItemCard
            item={mockWorkItem}
            onCompleteTask={onComplete}
            onRescheduleTask={vi.fn()}
            onCreateTaskForLead={vi.fn()}
          />
        </MemoryRouter>
      );

      const completeButton = screen.getByTestId('complete-task-work-item-task-777');
      expect(completeButton).toBeInTheDocument();
      expect(completeButton).toHaveTextContent('Marcar como concluída');

      fireEvent.click(completeButton);

      expect(onComplete).toHaveBeenCalledWith('work-item-task-777');
    });

    it('renders completed state badge in WorkItemCard when category is completed', () => {
      const completedItem: WorkItem = {
        ...mockWorkItem,
        category: 'completed',
      };

      render(
        <MemoryRouter>
          <WorkItemCard
            item={completedItem}
            onCompleteTask={vi.fn()}
            onRescheduleTask={vi.fn()}
            onCreateTaskForLead={vi.fn()}
          />
        </MemoryRouter>
      );

      expect(screen.getByText('Concluída')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Marcar como concluída/i })).not.toBeInTheDocument();
    });

    it('renders WorkDashboardPage, allows completing task, shows feedback, and refreshes queue', async () => {
      // Mock daily operations queue direct response
      vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: { success: true, task_id: 'work-item-task-777', already_completed: false },
        error: null,
      } as any);

      // Mock from('tasks') queries for dashboard and queue
      const mockQueueSelect = vi.fn().mockResolvedValue({
        count: 1,
        data: [{
          id: 'work-item-task-777',
          lead_id: 'lead-silva-999',
          task_type: 'call',
          title: 'Follow-up de Matrícula Dr. Silva',
          description: 'Confirmar documentos',
          status: 'pending',
          due_at: '2026-09-24T18:00:00Z',
          priority: 'high',
          task_source: 'manual',
          created_at: '2026-09-24T08:00:00Z',
          updated_at: '2026-09-24T08:00:00Z',
          completed_at: null,
          course_session_id: null,
          lead: {
            id: 'lead-silva-999',
            first_name: 'Dr.',
            last_name: 'Silva',
            email: 'silva@example.com',
            phone_raw: '+15551234567',
            phone_e164: '+15551234567',
            contact_preference: 'call',
            pipeline_stage: { id: 'ps-1', name: 'Matrícula', code: 'matricula' },
          },
        }],
        error: null,
      });

      vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
        if (table === 'tasks') {
          return {
            select: vi.fn().mockImplementation((_cols, opts) => {
              if (opts?.head) {
                return {
                  eq: vi.fn().mockReturnThis(),
                  gte: vi.fn().mockReturnThis(),
                  lt: vi.fn().mockReturnThis(),
                  not: vi.fn().mockResolvedValue({ count: 2, error: null }),
                  then: (fn: any) => Promise.resolve({ count: 3, error: null }).then(fn),
                } as any;
              }
              return {
                eq: vi.fn().mockReturnThis(),
                or: vi.fn().mockReturnThis(),
                order: vi.fn().mockReturnThis(),
                range: vi.fn().mockReturnValue(mockQueueSelect()),
              } as any;
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                select: vi.fn().mockResolvedValue({
                  data: [{ id: 'work-item-task-777', status: 'completed', completed_at: new Date().toISOString() }],
                  error: null,
                }),
              }),
            }),
          } as any;
        }
        if (table === 'conversations') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnThis(),
              then: (fn: any) => Promise.resolve({ count: 1, error: null }).then(fn),
            }),
          } as any;
        }
        return {} as any;
      });

      render(
        <MemoryRouter>
          <WorkDashboardPage />
        </MemoryRouter>
      );

      // Verify dashboard header and task card load
      expect(await screen.findByText('Tarefas Operacionais')).toBeInTheDocument();
      const taskCardTitle = await screen.findByText('Follow-up de Matrícula Dr. Silva');
      expect(taskCardTitle).toBeInTheDocument();

      // Click complete task button
      const completeButton = screen.getByRole('button', { name: /Marcar como concluída/i });
      fireEvent.click(completeButton);

      await waitFor(() => {
        expect(screen.getByText('Tarefa concluída')).toBeInTheDocument();
      });
    });
  });
});
