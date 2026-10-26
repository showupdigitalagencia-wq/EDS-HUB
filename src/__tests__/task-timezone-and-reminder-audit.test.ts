// =============================================================================
// EDS HUB — Task Timezone, Notification & Scheduler Audit Verification Tests
// =============================================================================
// Validates:
// 1. Timezone conversion and formatting for Florida (America/New_York) and other zones.
// 2. Automatic Daylight Saving Time (EDT vs EST) handling.
// 3. Common task with scheduled reminder.
// 4. Financial task (payment) with scheduled reminder.
// 5. Multi-device idempotency without PostgREST PGRST116 errors.
// 6. Temporary failure followed by safe retry without duplication.
// 7. Preservation of other users' behaviors and settings.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  setUserTimezone,
  parseLocalToUtc,
  parseLocalDatetimeInputToUtc,
  formatToLocalDatetimeInputValue,
} from '../utils/timezone';
import {
  buildTaskDueNotification,
} from '../features/notifications/utils/task-notification-format';
import {
  checkAndDispatchDueTaskReminders,
} from '../features/notifications/services/task-reminder-service';
import { supabase } from '../lib/supabase';

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: vi.fn(),
    },
    from: vi.fn(),
    functions: {
      invoke: vi.fn(),
    },
  },
}));

describe('Task Timezone & Notification Audit Specifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setUserTimezone('America/New_York'); // Client confirmed in Florida
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setUserTimezone(null);
  });

  // ---------------------------------------------------------------------------
  // 1. Timezone & Daylight Saving Time Validation
  // ---------------------------------------------------------------------------
  describe('1. Timezone Conversion & Daylight Saving Time (Florida America/New_York)', () => {
    it('accurately parses Summer local time (EDT = UTC-4) into UTC', () => {
      // July is in Daylight Saving Time (EDT)
      const utcIso = parseLocalToUtc('2026-07-15', '14:30', 'America/New_York');
      expect(utcIso).toBe('2026-07-15T18:30:00.000Z');
    });

    it('accurately parses Winter local time (EST = UTC-5) into UTC', () => {
      // January is in Standard Time (EST)
      const utcIso = parseLocalToUtc('2026-01-15', '14:30', 'America/New_York');
      expect(utcIso).toBe('2026-01-15T19:30:00.000Z');
    });

    it('formats UTC timestamps into local datetime-local input values in Florida', () => {
      // 18:30 UTC in Summer -> 14:30 EDT local
      const summerLocal = formatToLocalDatetimeInputValue('2026-07-15T18:30:00.000Z', 'America/New_York');
      expect(summerLocal).toBe('2026-07-15T14:30');

      // 19:30 UTC in Winter -> 14:30 EST local
      const winterLocal = formatToLocalDatetimeInputValue('2026-01-15T19:30:00.000Z', 'America/New_York');
      expect(winterLocal).toBe('2026-01-15T14:30');
    });

    it('handles parseLocalDatetimeInputToUtc seamlessly for modal input strings', () => {
      const utcIso = parseLocalDatetimeInputToUtc('2026-07-15T14:30', 'America/New_York');
      expect(utcIso).toBe('2026-07-15T18:30:00.000Z');

      const nullResult = parseLocalDatetimeInputToUtc('');
      expect(nullResult).toBeNull();
    });

    it('preserves independence of other user timezones without cross-contamination', () => {
      // User A in Florida (America/New_York) at 14:00 local: 18:00 UTC (summer)
      const floridaUtc = parseLocalToUtc('2026-07-15', '14:00', 'America/New_York');
      expect(floridaUtc).toBe('2026-07-15T18:00:00.000Z');

      // User B in São Paulo (America/Sao_Paulo) at 14:00 local: 17:00 UTC
      const spUtc = parseLocalToUtc('2026-07-15', '14:00', 'America/Sao_Paulo');
      expect(spUtc).toBe('2026-07-15T17:00:00.000Z');

      // User C in California (America/Los_Angeles) at 14:00 local: 21:00 UTC (summer)
      const laUtc = parseLocalToUtc('2026-07-15', '14:00', 'America/Los_Angeles');
      expect(laUtc).toBe('2026-07-15T21:00:00.000Z');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Common Task Notification Payload Composition
  // ---------------------------------------------------------------------------
  describe('2. Common Task Notification Payload Composition', () => {
    it('composes contextual notification for due tasks with lead name', () => {
      const notif = buildTaskDueNotification({
        taskId: 'task-100',
        taskTitle: 'Ligar para confirmar presença',
        leadId: 'lead-200',
        leadName: 'Dr. Roberto Santos',
        description: 'Verificar interesse na turma de Implantes de Novembro',
        taskType: 'call',
        isOverdue: false,
      });

      expect(notif.eventType).toBe('task_due');
      expect(notif.title).toBe('Ligar para confirmar presença — Dr. Roberto Santos');
      expect(notif.body).toBe('Verificar interesse na turma de Implantes de Novembro');
      expect(notif.deepLink).toBe('/leads/lead-200?taskId=task-100');
    });

    it('avoids repeating lead name if already part of task title', () => {
      const notif = buildTaskDueNotification({
        taskId: 'task-101',
        taskTitle: 'Ligar para Dr. Roberto Santos',
        leadId: 'lead-200',
        leadName: 'Dr. Roberto Santos',
        taskType: 'call',
      });

      expect(notif.title).toBe('Ligar para Dr. Roberto Santos');
    });

    it('composes overdue notification when task is past deadline', () => {
      const notif = buildTaskDueNotification({
        taskId: 'task-102',
        taskTitle: 'Follow-up proposta',
        leadId: 'lead-201',
        leadName: 'Dra. Camila',
        isOverdue: true,
      });

      expect(notif.eventType).toBe('task_overdue');
      expect(notif.title).toBe('EDS Hub — Tarefa atrasada');
      expect(notif.body).toBe("A tarefa 'Follow-up proposta' ainda não foi concluída.");
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Financial Tasks (Payments & Collections)
  // ---------------------------------------------------------------------------
  describe('3. Financial Tasks (Payments & Collections)', () => {
    it('composes payment_task_due when payment reminder is due today', () => {
      const notif = buildTaskDueNotification({
        taskId: 'pay-task-1',
        taskTitle: 'Cobrança entrada turma Nov',
        taskType: 'payment',
        leadId: 'lead-300',
        leadName: 'Dr. Anderson Lima',
        isOverdue: false,
      });

      expect(notif.eventType).toBe('payment_task_due');
      expect(notif.title).toBe('EDS Hub — Pagamento vence hoje');
      expect(notif.body).toBe("A tarefa 'Cobrança entrada turma Nov' vence hoje.");
      expect(notif.deepLink).toBe('/leads/lead-300?taskId=pay-task-1');
    });

    it('composes payment_overdue when payment task is overdue', () => {
      const notif = buildTaskDueNotification({
        taskId: 'pay-task-2',
        taskTitle: 'Cobrança da parcela 2',
        taskType: 'payment',
        leadId: 'lead-300',
        leadName: 'Dr. Anderson Lima',
        isOverdue: true,
      });

      expect(notif.eventType).toBe('payment_overdue');
      expect(notif.title).toBe('EDS Hub — Pagamento atrasado');
      expect(notif.body).toContain('A cobrança de Dr. Anderson Lima continua pendente');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Multi-Device Idempotency & Safe Retry
  // ---------------------------------------------------------------------------
  describe('4. Multi-Device Idempotency & Safe Retry', () => {
    it('successfully skips reminder when multiple device logs already exist without PGRST116 crash', async () => {
      const mockAuthUser = { id: 'admin-user-123' };
      (supabase.auth.getUser as any).mockResolvedValue({
        data: { user: mockAuthUser },
        error: null,
      });

      const dueTask = {
        id: 'task-due-1',
        title: 'Ligar para lead',
        description: 'Acompanhar inscrição',
        status: 'pending',
        due_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        created_by: 'user',
        lead_id: 'lead-1',
        task_type: 'call',
        priority: 'normal',
      };

      const tasksChain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [dueTask], error: null }),
      };

      // Mock push_notification_logs returning 2 records (multi-device)
      const logsChain: any = {
        select: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: [
            { id: 'log-1', status: 'sent' },
            { id: 'log-2', status: 'sent' },
          ],
          error: null,
        }),
      };

      const leadsChain: any = {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue({
          data: [{ id: 'lead-1', first_name: 'Maria', last_name: 'Silva' }],
          error: null,
        }),
      };

      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'tasks') return tasksChain;
        if (table === 'push_notification_logs') return logsChain;
        if (table === 'leads') return leadsChain;
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: [], error: null }) };
      });

      const results = await checkAndDispatchDueTaskReminders();

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('skipped_already_sent');
      // Edge function should NOT be invoked because it was recognized as already sent
      expect(supabase.functions.invoke).not.toHaveBeenCalled();
    });

    it('safely allows retry on temporary failure and succeeds on subsequent try', async () => {
      const mockAuthUser = { id: 'admin-user-123' };
      (supabase.auth.getUser as any).mockResolvedValue({
        data: { user: mockAuthUser },
        error: null,
      });

      const dueTask = {
        id: 'task-retry-1',
        title: 'Verificar documentos',
        status: 'pending',
        due_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        created_by: 'user',
        lead_id: 'lead-2',
        task_type: 'data_review',
        priority: 'high',
      };

      const tasksChain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [dueTask], error: null }),
      };

      // Logs initially empty (no prior send)
      const logsChainEmpty: any = {
        select: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      };

      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'tasks') return tasksChain;
        if (table === 'push_notification_logs') return logsChainEmpty;
        if (table === 'leads') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        return { select: vi.fn().mockReturnThis() };
      });

      // 1st attempt: transient failure
      (supabase.functions.invoke as any).mockResolvedValueOnce({
        data: null,
        error: { message: '503 Service Unavailable' },
      });

      const firstAttempt = await checkAndDispatchDueTaskReminders();
      expect(firstAttempt[0].status).toBe('failed');
      expect(firstAttempt[0].error).toContain('503');

      // 2nd attempt: succeeds
      (supabase.functions.invoke as any).mockResolvedValueOnce({
        data: { success: true, dispatched_count: 1 },
        error: null,
      });

      const secondAttempt = await checkAndDispatchDueTaskReminders();
      expect(secondAttempt[0].status).toBe('sent');
      expect(supabase.functions.invoke).toHaveBeenCalledTimes(2);
    });
  });
});
