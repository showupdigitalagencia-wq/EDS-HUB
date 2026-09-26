import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  formatContextualTaskTitle,
  formatContextualTaskBody,
  buildTaskDeepLink,
  buildTaskDueNotification,
} from '../features/notifications/utils/task-notification-format';
import { notifyTaskDue } from '../features/notifications/services/push-notification-service';
import { supabase } from '../lib/supabase';

// Mock supabase client
vi.mock('../lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: vi.fn(),
    },
    auth: {
      getUser: vi.fn(),
    },
    from: vi.fn(),
  },
}));

describe('Contextual Task Push Notification & Deep Link Specification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Task Title & Contextual Lead Name Formatting', () => {
    it('formats canonical task and lead name: "Ligar" + "Maria Silva" -> "Ligar — Maria Silva"', () => {
      const title = formatContextualTaskTitle('Ligar', 'Maria Silva');
      expect(title).toBe('Ligar — Maria Silva');
    });

    it('formats canonical task and lead name: "Enviar proposta" + "João Santos" -> "Enviar proposta — João Santos"', () => {
      const title = formatContextualTaskTitle('Enviar proposta', 'João Santos');
      expect(title).toBe('Enviar proposta — João Santos');
    });

    it('formats canonical task and lead name: "Follow-up" + "Dra. Fernanda" -> "Follow-up — Dra. Fernanda"', () => {
      const title = formatContextualTaskTitle('Follow-up', 'Dra. Fernanda');
      expect(title).toBe('Follow-up — Dra. Fernanda');
    });

    it('avoids duplicating lead name if already present in task title', () => {
      // Bad: "Ligar para Maria Silva — Maria Silva"
      // Good: "Ligar para Maria Silva"
      const title1 = formatContextualTaskTitle('Ligar para Maria Silva', 'Maria Silva');
      expect(title1).toBe('Ligar para Maria Silva');

      const title2 = formatContextualTaskTitle('Confirmar matrícula de Carlos Oliveira', 'Carlos Oliveira');
      expect(title2).toBe('Confirmar matrícula de Carlos Oliveira');

      const title3 = formatContextualTaskTitle('Ligar para Maria', 'Maria Silva');
      expect(title3).toBe('Ligar para Maria');
    });

    it('falls back gracefully to task title when lead is absent', () => {
      const title = formatContextualTaskTitle('Revisar relatório', null);
      expect(title).toBe('Revisar relatório');

      const titleEmpty = formatContextualTaskTitle('Revisar relatório', '');
      expect(titleEmpty).toBe('Revisar relatório');
    });

    it('falls back to lead name if task title is absent', () => {
      const title = formatContextualTaskTitle('', 'Maria Silva');
      expect(title).toBe('Maria Silva');
    });

    it('falls back to generic title when both task title and lead are absent', () => {
      const title = formatContextualTaskTitle('', '');
      expect(title).toBe('Tarefa pendente');
    });
  });

  describe('2. Notification Body Formatting', () => {
    it('uses real task description when present', () => {
      const body = formatContextualTaskBody('Follow-up do curso Intensive Implant Training');
      expect(body).toBe('Follow-up do curso Intensive Implant Training');
    });

    it('falls back to "Tarefa agendada para agora." when description is empty or null', () => {
      expect(formatContextualTaskBody(null)).toBe('Tarefa agendada para agora.');
      expect(formatContextualTaskBody('')).toBe('Tarefa agendada para agora.');
      expect(formatContextualTaskBody('   ')).toBe('Tarefa agendada para agora.');
    });

    it('truncates very long descriptions cleanly to fit mobile notification limits', () => {
      const longText = 'A'.repeat(300);
      const body = formatContextualTaskBody(longText);
      expect(body.length).toBeLessThanOrEqual(240);
      expect(body.endsWith('...')).toBe(true);
    });
  });

  describe('3. Deep Link Destination Routing', () => {
    it('generates specific lead profile deep link with taskId when leadId and taskId exist', () => {
      const deepLink = buildTaskDeepLink('task-999', 'lead-123');
      expect(deepLink).toBe('/leads/lead-123?taskId=task-999');
    });

    it('generates lead profile deep link without taskId if taskId is absent', () => {
      const deepLink = buildTaskDeepLink(null, 'lead-123');
      expect(deepLink).toBe('/leads/lead-123');
    });

    it('generates work dashboard deep link with taskId when leadId is absent', () => {
      const deepLink = buildTaskDeepLink('task-999', null);
      expect(deepLink).toBe('/work?taskId=task-999');
    });

    it('generates fallback work dashboard deep link when both are absent', () => {
      const deepLink = buildTaskDeepLink(null, null);
      expect(deepLink).toBe('/work');
    });
  });

  describe('4. Complete Notification Payload Composition', () => {
    it('builds full contextual notification payload with all identifiers', () => {
      const payload = buildTaskDueNotification({
        taskId: 'task-101',
        taskTitle: 'Ligar',
        leadId: 'lead-202',
        leadName: 'Maria Silva',
        description: 'Verificar disponibilidade de turma',
      });

      expect(payload).toEqual({
        title: 'Ligar — Maria Silva',
        body: 'Verificar disponibilidade de turma',
        deepLink: '/leads/lead-202?taskId=task-101',
        taskId: 'task-101',
        leadId: 'lead-202',
      });
    });
  });

  describe('5. notifyTaskDue Dispatch Integration', () => {
    it('dispatches contextual push notification with task_id, lead_id and deep_link', async () => {
      (supabase.auth.getUser as any).mockResolvedValue({
        data: { user: { id: 'admin-1' } },
      });
      (supabase.functions.invoke as any).mockResolvedValue({
        data: { success: true, dispatched_count: 1 },
        error: null,
      });

      const res = await notifyTaskDue({
        taskId: 'task-555',
        taskTitle: 'Ligar',
        leadId: 'lead-777',
        leadName: 'Maria Silva',
        description: 'Follow-up do curso Intensive Implant Training',
      });

      expect(res.success).toBe(true);
      expect(supabase.functions.invoke).toHaveBeenCalledWith('send-push-notification', {
        body: expect.objectContaining({
          event_type: 'task_due',
          event_id: 'task-555',
          title: 'Ligar — Maria Silva',
          body: 'Follow-up do curso Intensive Implant Training',
          deep_link: '/leads/lead-777?taskId=task-555',
        }),
      });
    });
  });

  describe('6. Service Worker notificationclick Navigation Specification', () => {
    it('verifies sw.js notificationclick dispatches NAVIGATE_TO_URL postMessage to open clients', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const swPath = path.resolve(process.cwd(), 'public/sw.js');
      const swContent = fs.readFileSync(swPath, 'utf-8');

      // Verifies notificationclick handler exists
      expect(swContent).toContain("self.addEventListener('notificationclick'");

      // Verifies postMessage NAVIGATE_TO_URL is called for open clients
      expect(swContent).toContain("type: 'NAVIGATE_TO_URL'");

      // Verifies clients.openWindow is called for closed PWA
      expect(swContent).toContain('self.clients.openWindow(fullTargetUrl)');

      // Verifies client.focus is called
      expect(swContent).toContain('client.focus()');
    });
  });
});
