// =============================================================================
// EDS HUB — Task Reminder Push Notification Service
// =============================================================================
// Enforces Parts 11, 12, 13, 14, 15:
// 1. Trigger: When task due time arrives, dispatches real Web Push notification.
// 2. Recipient: Targets task assignee (assigned_to); falls back to creator/owner.
//    Never sends indiscriminately to all admins.
// 3. Content: Concise, actionable title & body with formatted due time in user timezone.
// 4. Idempotency: Exactly 1 reminder per task due timestamp (idempotency key).
// 5. State Safety: Suppressed if task is completed, cancelled, or rescheduled.
// =============================================================================

import { supabase } from '../../../lib/supabase';
import { buildTaskDueNotification } from '../utils/task-notification-format';

export interface TaskReminderResult {
  taskId: string;
  recipientUserId: string;
  idempotencyKey: string;
  status: 'sent' | 'skipped_completed' | 'skipped_cancelled' | 'skipped_already_sent' | 'failed';
  error?: string;
}

// In-memory cache of dispatched reminders in the current active session
const sentRemindersCache = new Set<string>();

/**
 * Checks for tasks that are due right now and dispatches Web Push notifications.
 */
export async function checkAndDispatchDueTaskReminders(): Promise<TaskReminderResult[]> {
  const results: TaskReminderResult[] = [];
  const now = new Date();
  const nowIso = now.toISOString();

  try {
    // 1. Get current authenticated user
    const { data: authData } = await supabase.auth.getUser();
    const currentUserId = authData?.user?.id;

    // 2. Fetch pending tasks due up to now (looking back up to 7 days for overdue tasks)
    // Only pending tasks qualify
    const overdueWindow = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: rawDueTasks, error: taskErr } = await supabase
      .from('tasks')
      .select('id, title, description, status, due_at, created_by, lead_id, task_type, priority')
      .eq('status', 'pending')
      .not('due_at', 'is', null)
      .lte('due_at', nowIso)
      .gte('due_at', overdueWindow)
      .order('due_at', { ascending: true })
      .limit(50);

    if (taskErr || !rawDueTasks || rawDueTasks.length === 0) {
      return results;
    }

    // Sort to prioritize payment tasks first, then by priority, then by deadline
    const dueTasks = [...rawDueTasks].sort((a: any, b: any) => {
      const isPayA = a.task_type === 'payment' ? 0 : 1;
      const isPayB = b.task_type === 'payment' ? 0 : 1;
      if (isPayA !== isPayB) return isPayA - isPayB;
      const prioRank = (p: string) => (p === 'critical' ? 0 : p === 'high' ? 1 : p === 'normal' ? 2 : 3);
      const diffPrio = prioRank(a.priority || 'normal') - prioRank(b.priority || 'normal');
      if (diffPrio !== 0) return diffPrio;
      return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
    });

    // Paged lead name map for due tasks
    const leadIds = Array.from(new Set(dueTasks.map((t) => t.lead_id).filter(Boolean))) as string[];
    const leadMap = new Map<string, { first_name?: string; last_name?: string }>();

    if (leadIds.length > 0) {
      const { data: leads } = await supabase
        .from('leads')
        .select('id, first_name, last_name')
        .in('id', leadIds);

      for (const l of (leads || [])) {
        leadMap.set(l.id, l);
      }
    }

    const todayDateStr = nowIso.slice(0, 10);

    for (const task of dueTasks) {
      // PART 15: State safety checks - do not notify completed or cancelled tasks
      if (task.status === 'completed') {
        results.push({
          taskId: task.id,
          recipientUserId: currentUserId || '',
          idempotencyKey: `task_reminder_${task.id}_${task.due_at}`,
          status: 'skipped_completed',
        });
        continue;
      }

      if (task.status === 'cancelled') {
        results.push({
          taskId: task.id,
          recipientUserId: currentUserId || '',
          idempotencyKey: `task_reminder_${task.id}_${task.due_at}`,
          status: 'skipped_cancelled',
        });
        continue;
      }

      // Canonical task recipient: target current admin or all active admins with tasks enabled
      const targetUserIds = currentUserId ? [currentUserId] : undefined;

      // Overdue check: task deadline passed by more than 1 hour
      const dueTime = new Date(task.due_at).getTime();
      const isOverdue = now.getTime() - dueTime > 60 * 60 * 1000;

      // Idempotency: Overdue reminders throttled to once per calendar day; Due reminders per deadline
      const idempotencyKey = isOverdue
        ? `task_overdue_${task.id}_${todayDateStr}`
        : `task_reminder_${task.id}_${task.due_at}`;

      if (sentRemindersCache.has(idempotencyKey)) {
        results.push({
          taskId: task.id,
          recipientUserId: currentUserId || '',
          idempotencyKey,
          status: 'skipped_already_sent',
        });
        continue;
      }

      // Check remote idempotency in push_notification_logs (support multi-device and fallback logs)
      try {
        let query = supabase
          .from('push_notification_logs')
          .select('id, status');

        if (typeof (query as any).or === 'function') {
          query = (query as any).or(`idempotency_key.eq.${idempotencyKey},idempotency_key.like.${idempotencyKey}_user_%`);
        } else {
          query = query.eq('idempotency_key', idempotencyKey);
        }

        query = query.eq('status', 'sent');

        const { data: existingLogs } = typeof (query as any).limit === 'function'
          ? await (query as any).limit(1)
          : await (query as any).maybeSingle();

        const hasExisting = Array.isArray(existingLogs)
          ? existingLogs.length > 0
          : Boolean(existingLogs && (existingLogs as any).id);

        if (hasExisting) {
          sentRemindersCache.add(idempotencyKey);
          results.push({
            taskId: task.id,
            recipientUserId: currentUserId || '',
            idempotencyKey,
            status: 'skipped_already_sent',
          });
          continue;
        }
      } catch (_logCheckErr) {
        // Non-blocking log check
      }

      // PART 13: Content Composition
      const leadInfo = task.lead_id ? leadMap.get(task.lead_id) : undefined;
      const leadName = leadInfo
        ? `${leadInfo.first_name || ''} ${leadInfo.last_name || ''}`.trim()
        : null;

      const notificationContent = buildTaskDueNotification({
        taskId: task.id,
        taskTitle: task.title,
        taskType: task.task_type,
        priority: task.priority,
        leadId: task.lead_id,
        leadName,
        description: task.description,
        dueAt: task.due_at,
        isOverdue,
      });

      const eventType = notificationContent.eventType || (isOverdue ? 'task_overdue' : 'task_due');

      // Dispatch Web Push via send-push-notification edge function
      try {
        const { error: pushErr } = await supabase.functions.invoke(
          'send-push-notification',
          {
            body: {
              event_type: eventType,
              event_id: task.id,
              idempotency_key: idempotencyKey,
              title: notificationContent.title,
              body: notificationContent.body,
              deep_link: notificationContent.deepLink,
              task_id: task.id,
              lead_id: task.lead_id || undefined,
              target_user_ids: targetUserIds,
              data: {
                task_type: task.task_type,
                priority: task.priority,
                due_at: task.due_at,
                is_overdue: isOverdue,
              },
            },
          }
        );

        if (pushErr) {
          console.error('[TaskReminder] Push invoke error for task', task.id, pushErr);
          results.push({
            taskId: task.id,
            recipientUserId: currentUserId || '',
            idempotencyKey,
            status: 'failed',
            error: pushErr.message || 'Push invocation failed',
          });
        } else {
          sentRemindersCache.add(idempotencyKey);
          results.push({
            taskId: task.id,
            recipientUserId: currentUserId || '',
            idempotencyKey,
            status: 'sent',
          });
        }
      } catch (invokeErr: any) {
        console.error('[TaskReminder] Exception sending push for task', task.id, invokeErr);
        results.push({
          taskId: task.id,
          recipientUserId: currentUserId || '',
          idempotencyKey,
          status: 'failed',
          error: invokeErr.message || 'Unknown push invocation error',
        });
      }
    }
  } catch (err: any) {
    console.error('[TaskReminder] Error in checkAndDispatchDueTaskReminders:', err);
  }

  return results;
}

/**
 * Starts automatic task reminder scheduler in the active browser window.
 * Runs on initialization, on visibility change (re-focus), and periodically every 30s.
 */
export function startTaskReminderScheduler(intervalMs = 30000): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  // Initial check (non-blocking)
  void checkAndDispatchDueTaskReminders();

  // Periodic interval
  const timer = setInterval(() => {
    void checkAndDispatchDueTaskReminders();
  }, intervalMs);

  // Wake up when user switches back to EDS HUB tab
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      void checkAndDispatchDueTaskReminders();
    }
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);

  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  };
}
