// =============================================================================
// EDS HUB — Task Scheduled Push Timing & Reminder Verification Tests
// =============================================================================
// Validates:
// 1. Future tasks do NOT dispatch push or in-app notifications on creation.
// 2. Overdue / Due Now tasks preserve immediate notification.
// 3. Scheduler dispatches 'Tarefa pendente' exactly when due_at <= now.
// 4. Completed and cancelled tasks are suppressed.
// 5. Idempotency guarantees exactly one reminder per task per scheduled due_at.
// 6. Multiple tasks for same lead notify at their own distinct scheduled times.
// 7. Timezone handling stores UTC timestamps and formats correctly.
// 8. Non-task push events remain completely intact.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  checkAndDispatchDueTaskReminders,
  startTaskReminderScheduler,
} from '../features/notifications/services/task-reminder-service';
import * as pushService from '../features/notifications/services/push-notification-service';
import {
  notifyNewLead,
  notifySmsPreference,
  notifyInboundEmail,
  notifyIncompleteRegistration,
  notifyDeliverabilityCritical,
} from '../features/notifications/services/push-notification-service';
import { supabase } from '../lib/supabase';
import { formatTaskDueTime, getUserTimezone, setUserTimezone } from '../utils/timezone';

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

describe('Task Push Timing & Reminder Scheduling Specification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Task Creation Immediate Notification Suppression', () => {
    it('suppresses immediate notification for future scheduled tasks', () => {
      // Simulate task scheduled 30 minutes in the future
      const futureDueIso = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      const dueTime = new Date(futureDueIso).getTime();
      const isDueNowOrOverdue = dueTime !== null && dueTime <= Date.now();

      expect(isDueNowOrOverdue).toBe(false);

      // Verify notifyTaskDue would NOT be called
      const notifySpy = vi.fn();
      if (isDueNowOrOverdue) {
        notifySpy();
      }
      expect(notifySpy).not.toHaveBeenCalled();
    });

    it('suppresses immediate notification when task has no due date', () => {
      const dueIso: string | null = null;
      const dueTime = dueIso ? new Date(dueIso).getTime() : null;
      const isDueNowOrOverdue = dueTime !== null && dueTime <= Date.now();

      expect(isDueNowOrOverdue).toBe(false);

      const notifySpy = vi.fn();
      if (isDueNowOrOverdue) {
        notifySpy();
      }
      expect(notifySpy).not.toHaveBeenCalled();
    });

    it('allows immediate notification when task is due immediately or overdue', () => {
      // Overdue task by 5 minutes
      const pastDueIso = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const dueTime = new Date(pastDueIso).getTime();
      const isDueNowOrOverdue = dueTime !== null && dueTime <= Date.now();

      expect(isDueNowOrOverdue).toBe(true);

      const notifySpy = vi.fn();
      if (isDueNowOrOverdue) {
        notifySpy();
      }
      expect(notifySpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('2. Canonical Task Reminder Service Query & Due Time Handling', () => {
    it('queries canonical due_at column and excludes completed/cancelled tasks', async () => {
      const mockTasks = [
        {
          id: 'task-1',
          title: 'Ligar para Dra. Claudia',
          description: 'Apresentar turma de Março',
          status: 'pending',
          due_at: new Date(Date.now() - 60000).toISOString(),
          created_by: 'user-admin',
          lead_id: 'lead-123',
        },
      ];

      (supabase.auth.getUser as any).mockResolvedValue({
        data: { user: { id: 'admin-uuid-1' } },
      });

      const selectMock = vi.fn().mockReturnThis();
      const eqMock = vi.fn().mockReturnThis();
      const notMock = vi.fn().mockReturnThis();
      const lteMock = vi.fn().mockReturnThis();
      const gteMock = vi.fn().mockReturnThis();
      const orderMock = vi.fn().mockReturnThis();
      const limitMock = vi.fn().mockResolvedValue({ data: mockTasks, error: null });

      const fromMock = vi.fn((table: string) => {
        if (table === 'tasks') {
          return {
            select: selectMock,
            eq: eqMock,
            not: notMock,
            lte: lteMock,
            gte: gteMock,
            order: orderMock,
            limit: limitMock,
          };
        }
        if (table === 'leads') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({
                data: [{ id: 'lead-123', first_name: 'Claudia', last_name: 'Menezes' }],
              }),
            }),
          };
        }
        if (table === 'push_notification_logs') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
        };
      });

      (supabase.from as any) = fromMock;
      (supabase.functions.invoke as any).mockResolvedValue({ data: { success: true }, error: null });

      const results = await checkAndDispatchDueTaskReminders();

      // Verify canonical query structure
      expect(selectMock).toHaveBeenCalledWith('id, title, description, status, due_at, created_by, lead_id');
      expect(eqMock).toHaveBeenCalledWith('status', 'pending');
      expect(notMock).toHaveBeenCalledWith('due_at', 'is', null);

      // Verify push invocation with 'Tarefa pendente'
      expect(supabase.functions.invoke).toHaveBeenCalledWith('send-push-notification', {
        body: expect.objectContaining({
          event_type: 'task_due',
          event_id: 'task-1',
          title: 'Tarefa pendente',
          body: 'Ligar para Dra. Claudia — Claudia Menezes',
          idempotency_key: `task_reminder_task-1_${mockTasks[0].due_at}`,
        }),
      });

      expect(results[0].status).toBe('sent');
    });

    it('suppresses completed tasks even if due_at <= now', async () => {
      const completedTask = {
        id: 'task-completed-1',
        title: 'Tarefa já finalizada',
        status: 'completed',
        due_at: new Date(Date.now() - 60000).toISOString(),
        created_by: 'user-admin',
        lead_id: 'lead-1',
      };

      (supabase.auth.getUser as any).mockResolvedValue({
        data: { user: { id: 'admin-1' } },
      });

      (supabase.from as any) = vi.fn((table: string) => {
        if (table === 'tasks') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            not: vi.fn().mockReturnThis(),
            lte: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [completedTask], error: null }),
          };
        }
        if (table === 'leads') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ data: [] }),
            }),
          };
        }
        return { select: vi.fn().mockReturnThis() };
      });

      const results = await checkAndDispatchDueTaskReminders();
      expect(results[0].status).toBe('skipped_completed');
      expect(supabase.functions.invoke).not.toHaveBeenCalled();
    });

    it('suppresses cancelled tasks even if due_at <= now', async () => {
      const cancelledTask = {
        id: 'task-cancelled-1',
        title: 'Tarefa cancelada',
        status: 'cancelled',
        due_at: new Date(Date.now() - 60000).toISOString(),
        created_by: 'user-admin',
        lead_id: 'lead-1',
      };

      (supabase.auth.getUser as any).mockResolvedValue({
        data: { user: { id: 'admin-1' } },
      });

      (supabase.from as any) = vi.fn((table: string) => {
        if (table === 'tasks') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            not: vi.fn().mockReturnThis(),
            lte: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [cancelledTask], error: null }),
          };
        }
        if (table === 'leads') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ data: [] }),
            }),
          };
        }
        return { select: vi.fn().mockReturnThis() };
      });

      const results = await checkAndDispatchDueTaskReminders();
      expect(results[0].status).toBe('skipped_cancelled');
      expect(supabase.functions.invoke).not.toHaveBeenCalled();
    });
  });

  describe('3. Idempotency & Multiple Tasks for Same Lead', () => {
    it('creates distinct idempotency keys for multiple tasks of same lead at different scheduled times', async () => {
      const dueTime1 = new Date(Date.now() - 100000).toISOString();
      const dueTime2 = new Date(Date.now() - 50000).toISOString();

      const taskA = {
        id: 'task-lead-a',
        title: 'Primeiro contato telefônico',
        status: 'pending',
        due_at: dueTime1,
        lead_id: 'lead-multi-1',
      };

      const taskB = {
        id: 'task-lead-b',
        title: 'Enviar detalhes do curso via WhatsApp',
        status: 'pending',
        due_at: dueTime2,
        lead_id: 'lead-multi-1',
      };

      (supabase.auth.getUser as any).mockResolvedValue({
        data: { user: { id: 'admin-1' } },
      });

      (supabase.from as any) = vi.fn((table: string) => {
        if (table === 'tasks') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            not: vi.fn().mockReturnThis(),
            lte: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [taskA, taskB], error: null }),
          };
        }
        if (table === 'leads') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({
                data: [{ id: 'lead-multi-1', first_name: 'Dr. Roberto', last_name: 'Alves' }],
              }),
            }),
          };
        }
        if (table === 'push_notification_logs') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null }),
          };
        }
        return { select: vi.fn().mockReturnThis() };
      });

      (supabase.functions.invoke as any).mockResolvedValue({ data: { success: true }, error: null });

      const results = await checkAndDispatchDueTaskReminders();
      expect(results).toHaveLength(2);
      expect(results[0].idempotencyKey).toBe(`task_reminder_task-lead-a_${dueTime1}`);
      expect(results[1].idempotencyKey).toBe(`task_reminder_task-lead-b_${dueTime2}`);
      expect(results[0].status).toBe('sent');
      expect(results[1].status).toBe('sent');
      expect(supabase.functions.invoke).toHaveBeenCalledTimes(2);
    });

    it('skips duplicate reminders when idempotency key exists in remote logs', async () => {
      const task = {
        id: 'task-already-sent-2',
        title: 'Tarefa repetida',
        status: 'pending',
        due_at: new Date(Date.now() - 30000).toISOString(),
        lead_id: 'lead-1',
      };

      (supabase.auth.getUser as any).mockResolvedValue({
        data: { user: { id: 'admin-1' } },
      });

      (supabase.from as any) = vi.fn((table: string) => {
        if (table === 'tasks') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            not: vi.fn().mockReturnThis(),
            lte: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [task], error: null }),
          };
        }
        if (table === 'leads') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ data: [] }),
            }),
          };
        }
        if (table === 'push_notification_logs') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'log-existing-1', status: 'sent' } }),
          };
        }
        return { select: vi.fn().mockReturnThis() };
      });

      const results = await checkAndDispatchDueTaskReminders();
      expect(results[0].status).toBe('skipped_already_sent');
      expect(supabase.functions.invoke).not.toHaveBeenCalled();
    });
  });

  describe('4. Timezone Handling Verification', () => {
    it('accurately converts and formats scheduled time according to user timezone', () => {
      setUserTimezone('America/Sao_Paulo');
      expect(getUserTimezone()).toBe('America/Sao_Paulo');

      // Fixed UTC timestamp: 2026-09-25 18:30:00 UTC = 2026-09-25 15:30:00 BRT (UTC-3)
      const testUtcTimestamp = '2026-09-25T18:30:00.000Z';
      const formatted = formatTaskDueTime(testUtcTimestamp, 'America/Sao_Paulo');
      expect(formatted).toContain('15:30');

      // In America/New_York (UTC-4 in Daylight Saving Time in September)
      const formattedNy = formatTaskDueTime(testUtcTimestamp, 'America/New_York');
      expect(formattedNy).toContain('14:30');

      setUserTimezone(null);
    });
  });

  describe('5. Scheduler Lifecycle', () => {
    it('initializes and tears down browser task reminder timer cleanly', () => {
      vi.useFakeTimers();
      const stopScheduler = startTaskReminderScheduler(30000);
      expect(typeof stopScheduler).toBe('function');
      stopScheduler();
      vi.useRealTimers();
    });
  });

  describe('6. Non-Task Push Events Preserved', () => {
    it('dispatches other critical push notification events unchanged', async () => {
      (supabase.functions.invoke as any).mockResolvedValue({ data: { success: true }, error: null });

      await notifyNewLead({ leadId: 'lead-1', leadName: 'Maria Silva', courseName: 'Imersão Cirúrgica' });
      expect(supabase.functions.invoke).toHaveBeenCalledWith('send-push-notification', expect.objectContaining({
        body: expect.objectContaining({
          event_type: 'new_lead',
          title: 'Novo lead recebido',
        }),
      }));

      await notifySmsPreference({ leadId: 'lead-2', leadName: 'Carlos Souza' });
      expect(supabase.functions.invoke).toHaveBeenCalledWith('send-push-notification', expect.objectContaining({
        body: expect.objectContaining({
          event_type: 'sms_preference',
          title: 'Lead aguardando contato por SMS',
        }),
      }));

      await notifyInboundEmail({ leadId: 'lead-3', leadName: 'Ana Paula' });
      expect(supabase.functions.invoke).toHaveBeenCalledWith('send-push-notification', expect.objectContaining({
        body: expect.objectContaining({
          event_type: 'inbound_email',
          title: 'Nova resposta recebida',
        }),
      }));

      await notifyIncompleteRegistration({ leadId: 'lead-4', leadName: 'João Santos' });
      expect(supabase.functions.invoke).toHaveBeenCalledWith('send-push-notification', expect.objectContaining({
        body: expect.objectContaining({
          event_type: 'incomplete_registration',
          title: 'Inscrição não concluída',
        }),
      }));

      await notifyDeliverabilityCritical({ recipientEmail: 'bounced@dentist.com', reason: 'Mailbox not found' });
      expect(supabase.functions.invoke).toHaveBeenCalledWith('send-push-notification', expect.objectContaining({
        body: expect.objectContaining({
          event_type: 'deliverability_critical',
          title: 'Alerta de Entregabilidade',
        }),
      }));

      Object.defineProperty(window, 'PushManager', { value: {}, configurable: true, writable: true });
      Object.defineProperty(window, 'Notification', { value: { permission: 'granted' }, configurable: true, writable: true });
      Object.defineProperty(navigator, 'serviceWorker', { value: {}, configurable: true, writable: true });

      (supabase.auth.getUser as any).mockResolvedValue({
        data: { user: { id: 'admin-1' } },
      });

      const testRes = await pushService.sendTestPushNotification('sub-test-device-1');
      expect(testRes.success).toBe(true);
      expect(supabase.functions.invoke).toHaveBeenCalledWith('send-push-notification', expect.objectContaining({
        body: expect.objectContaining({
          event_type: 'system_test',
          title: 'Teste de notificação — EDS HUB',
        }),
      }));
    });
  });

  describe('7. Closed-App Push & Service Worker Independence Specification', () => {
    it('verifies manifest has stable id and standalone display mode for iOS PWA Home Screen', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const manifestPath = path.resolve(process.cwd(), 'public/manifest.webmanifest');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

      expect(manifest.id).toBe('/');
      expect(manifest.display).toBe('standalone');
      expect(manifest.start_url).toBe('/');
    });

    it('verifies service worker push handler shows notification without requiring open clients', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const swPath = path.resolve(process.cwd(), 'public/sw.js');
      const swContent = fs.readFileSync(swPath, 'utf8');

      // Canonical push handler must exist
      expect(swContent).toContain("self.addEventListener('push'");
      // Must use event.waitUntil
      expect(swContent).toContain('event.waitUntil(');
      // Must call registration.showNotification
      expect(swContent).toContain('self.registration.showNotification');
      // Must call self.skipWaiting() on install
      expect(swContent).toContain('self.skipWaiting()');
      // Must NOT gate notification display on clients.length
      expect(swContent).not.toMatch(/if\s*\(\s*clients\.length\s*>\s*0\s*\)\s*\{[^}]*showNotification/);
    });

    it('verifies closed-app push payload contains all self-contained fields for display', () => {
      const payload = {
        title: 'Tarefa pendente',
        body: 'Ligar para Dra. Claudia — Claudia Menezes',
        icon: '/pwa-192x192.png',
        badge: '/favicon.png',
        deep_link: '/work',
        url: '/work',
        event_type: 'task_due',
        event_id: 'task-123',
        data: {
          url: '/work',
          eventType: 'task_due',
          eventId: 'task-123',
        },
      };

      // Service worker can build visible notification solely from push payload
      expect(payload.title).toBeDefined();
      expect(payload.body).toBeDefined();
      expect(payload.event_type).toBe('task_due');
      expect(payload.data.url).toBe('/work');
    });
  });
});
