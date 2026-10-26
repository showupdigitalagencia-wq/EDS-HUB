// =============================================================================
// EDS HUB — Contextual Task Notification Formatter
// =============================================================================
// Formats push and in-app notifications for task reminders with real task + lead data.
// Rules:
// 1. Contextual Title: "[Task title] — [Lead name]"
// 2. Lead Deduplication: If task title already mentions lead name, avoid repeating.
// 3. Graceful Fallback: If task has no lead, display task title (or "Tarefa pendente").
// 4. Concise Body: Use task description if present, else "Tarefa agendada para agora."
// 5. Deep Link: Returns "/leads/:leadId?taskId=:taskId" (or "/work?taskId=:taskId").
// =============================================================================

export interface TaskNotificationParams {
  taskId?: string | null;
  taskTitle?: string | null;
  taskType?: string | null;
  priority?: string | null;
  leadId?: string | null;
  leadName?: string | null;
  description?: string | null;
  dueAt?: string | null;
  isOverdue?: boolean;
}

export interface TaskNotificationContent {
  title: string;
  body: string;
  deepLink: string;
  taskId?: string;
  leadId?: string;
  eventType?: 'task_due' | 'task_overdue' | 'payment_task_due' | 'payment_overdue';
}

/**
 * Formats a contextual task title: e.g. "Ligar — Maria Silva"
 * Avoids duplicate lead name if already present in task title.
 */
export function formatContextualTaskTitle(
  taskTitle?: string | null,
  leadName?: string | null
): string {
  const cleanTitle = (taskTitle || '').trim();
  const cleanLeadName = (leadName || '').trim();

  // If no lead name available, fallback to task title or generic title
  if (!cleanLeadName) {
    return cleanTitle || 'Tarefa pendente';
  }

  // If no task title available, use lead name directly
  if (!cleanTitle) {
    return cleanLeadName;
  }

  // Check if task title already contains the lead name or first name to avoid duplication
  const titleLower = cleanTitle.toLowerCase();
  const leadLower = cleanLeadName.toLowerCase();
  const firstName = cleanLeadName.split(/\s+/)[0]?.toLowerCase();

  // E.g. "Ligar para Maria Silva" already contains "Maria Silva" or "Maria"
  if (
    titleLower.includes(leadLower) ||
    (firstName && firstName.length > 2 && titleLower.includes(firstName))
  ) {
    return cleanTitle;
  }

  // Canonical safe format: [Task title] — [Lead name]
  return `${cleanTitle} — ${cleanLeadName}`;
}

/**
 * Formats a concise, useful notification body.
 * Uses task description if present, else fallback prompt.
 */
export function formatContextualTaskBody(description?: string | null): string {
  const cleanDesc = (description || '').trim();
  if (cleanDesc) {
    return cleanDesc.length > 240 ? `${cleanDesc.slice(0, 237)}...` : cleanDesc;
  }
  return 'Tarefa agendada para agora.';
}

/**
 * Builds the canonical deep link for task click destination.
 * If leadId is present: navigates directly to lead profile with taskId query param.
 * If leadId is absent: navigates to work dashboard with taskId query param.
 */
export function buildTaskDeepLink(
  taskId?: string | null,
  leadId?: string | null
): string {
  const cleanTaskId = (taskId || '').trim();
  const cleanLeadId = (leadId || '').trim();

  if (cleanLeadId) {
    return cleanTaskId ? `/leads/${cleanLeadId}?taskId=${cleanTaskId}` : `/leads/${cleanLeadId}`;
  }

  return cleanTaskId ? `/work?taskId=${cleanTaskId}` : '/work';
}

/**
 * Composes the complete contextual task notification payload.
 * Supports payment tasks, overdue tasks, and general tasks.
 */
export function buildTaskDueNotification(params: TaskNotificationParams): TaskNotificationContent {
  const isPayment = params.taskType === 'payment';
  const isOverdue = !!params.isOverdue;
  const deepLink = buildTaskDeepLink(params.taskId, params.leadId);

  let title: string;
  let body: string;
  let eventType: 'task_due' | 'task_overdue' | 'payment_task_due' | 'payment_overdue';

  if (isPayment) {
    if (isOverdue) {
      eventType = 'payment_overdue';
      title = 'EDS Hub — Pagamento atrasado';
      body = params.leadName
        ? `A cobrança de ${params.leadName} continua pendente. Verifique a tarefa no EDS Hub.`
        : 'A cobrança do aluno continua pendente. Verifique a tarefa no EDS Hub.';
    } else {
      eventType = 'payment_task_due';
      title = 'EDS Hub — Pagamento vence hoje';
      body = params.taskTitle
        ? `A tarefa '${params.taskTitle}' vence hoje.`
        : 'A cobrança do aluno vence hoje.';
    }
  } else {
    if (isOverdue) {
      eventType = 'task_overdue';
      title = 'EDS Hub — Tarefa atrasada';
      body = params.taskTitle
        ? `A tarefa '${params.taskTitle}' ainda não foi concluída.`
        : 'A tarefa de acompanhamento ainda não foi concluída.';
    } else {
      eventType = 'task_due';
      title = formatContextualTaskTitle(params.taskTitle, params.leadName);
      body = formatContextualTaskBody(params.description);
    }
  }

  return {
    title,
    body,
    deepLink,
    taskId: params.taskId || undefined,
    leadId: params.leadId || undefined,
    eventType,
  };
}
