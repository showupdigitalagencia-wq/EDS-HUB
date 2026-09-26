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

export interface TaskNotificationContent {
  title: string;
  body: string;
  deepLink: string;
  taskId?: string;
  leadId?: string;
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
 */
export function buildTaskDueNotification(params: {
  taskId?: string | null;
  taskTitle?: string | null;
  leadId?: string | null;
  leadName?: string | null;
  description?: string | null;
}): TaskNotificationContent {
  const title = formatContextualTaskTitle(params.taskTitle, params.leadName);
  const body = formatContextualTaskBody(params.description);
  const deepLink = buildTaskDeepLink(params.taskId, params.leadId);

  return {
    title,
    body,
    deepLink,
    taskId: params.taskId || undefined,
    leadId: params.leadId || undefined,
  };
}
