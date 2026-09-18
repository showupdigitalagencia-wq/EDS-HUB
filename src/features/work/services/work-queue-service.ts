// =============================================================================
// Daily Operations & Work Queue Service (Phase 5 Block 1)
// =============================================================================

import { supabase } from '../../../lib/supabase';
import type {
  DailyOperationsDashboardKpis,
  DailyOperationsQueueResponse,
  DailyOperationsFilter,
  WorkItem,
  Task,
  TaskPriority,
  TaskType,
  TaskSource,
} from '../../../types/database';

// -----------------------------------------------------------------------------
// Pure Business & Metric Derivation Functions
// -----------------------------------------------------------------------------

/**
 * Checks if a task due date is overdue relative to now
 */
export function deriveIsOverdue(dueAt: string | null, nowIso?: string): boolean {
  if (!dueAt) return false;
  const now = new Date(nowIso || new Date().toISOString()).getTime();
  const due = new Date(dueAt).getTime();
  return due < now;
}

/**
 * Checks if a task due date falls within organization "today"
 */
export function deriveIsToday(
  dueAt: string | null,
  timezone = 'America/New_York',
  nowIso?: string
): boolean {
  if (!dueAt) return false;
  try {
    const nowDate = new Date(nowIso || new Date().toISOString());
    const dueDate = new Date(dueAt);

    // Format both dates in organization timezone (YYYY-MM-DD)
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    return formatter.format(nowDate) === formatter.format(dueDate);
  } catch {
    // Fallback to UTC if timezone is invalid
    const nowStr = (nowIso ? new Date(nowIso) : new Date()).toISOString().slice(0, 10);
    return dueAt.slice(0, 10) === nowStr;
  }
}

/**
 * Derives the single canonical Next Action from a list of open tasks.
 * Prioritizes:
 * 1. Overdue tasks first (earliest due_at)
 * 2. Next upcoming due_at
 * 3. Tasks without due_at
 * 4. Deterministic tiebreak: critical > high > normal > low, then created_at ASC
 */
export function deriveNextAction(tasks: Task[]): {
  hasNextAction: boolean;
  nextTask: Task | null;
} {
  const openTasks = tasks.filter((t) => t.status === 'pending');
  if (openTasks.length === 0) {
    return { hasNextAction: false, nextTask: null };
  }

  const priorityWeight: Record<TaskPriority, number> = {
    critical: 4,
    high: 3,
    normal: 2,
    low: 1,
  };

  const sorted = [...openTasks].sort((a, b) => {
    const now = Date.now();
    const aDue = a.due_at ? new Date(a.due_at).getTime() : null;
    const bDue = b.due_at ? new Date(b.due_at).getTime() : null;

    const aOverdue = aDue !== null && aDue < now;
    const bOverdue = bDue !== null && bDue < now;

    // 1. Overdue tasks first
    if (aOverdue && !bOverdue) return -1;
    if (!aOverdue && bOverdue) return 1;

    // 2. Earliest due date if both have due dates
    if (aDue !== null && bDue !== null) {
      if (aDue !== bDue) return aDue - bDue;
    } else if (aDue !== null && bDue === null) {
      return -1;
    } else if (aDue === null && bDue !== null) {
      return 1;
    }

    // 3. Priority tiebreak
    const pDiff = (priorityWeight[b.priority] || 2) - (priorityWeight[a.priority] || 2);
    if (pDiff !== 0) return pDiff;

    // 4. Created at tiebreak
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  return {
    hasNextAction: true,
    nextTask: sorted[0] || null,
  };
}

/**
 * Maps reason codes and parameters to a deterministic WorkItemPriority
 */
export function deriveWorkItemPriority(
  reasonCode: string | null,
  taskPriority?: TaskPriority,
  sessionDaysAway?: number
): TaskPriority {
  if (taskPriority) return taskPriority;

  switch (reasonCode) {
    case 'SESSION_CANCELLED_REASSIGNMENT_REQUIRED':
    case 'ENROLLMENT_WITHOUT_SESSION':
    case 'NO_SHOW':
      return 'critical';
    case 'UPCOMING_SESSION_UNREADY':
      return sessionDaysAway !== undefined && sessionDaysAway <= 3 ? 'critical' : 'high';
    case 'CONVERSATION_NEEDS_REPLY':
    case 'HOT_LEAD_NO_ACTION':
    case 'POST_COURSE_FOLLOWUP_OVERDUE':
      return 'high';
    case 'PAYMENT_OUTSTANDING':
      return sessionDaysAway !== undefined && sessionDaysAway <= 7 ? 'high' : 'normal';
    case 'LEAD_NO_NEXT_ACTION':
    case 'STALE_LEAD':
    case 'FEEDBACK_PENDING':
      return 'normal';
    case 'TESTIMONIAL_REQUEST_DUE':
    case 'NEXT_COURSE_OPPORTUNITY':
      return 'low';
    default:
      return 'normal';
  }
}

// -----------------------------------------------------------------------------
// Database & RPC Invocations
// -----------------------------------------------------------------------------

/**
 * Fetches KPIs and summary counts for Daily Operations dashboard
 */
export async function fetchDailyOperationsDashboard(): Promise<DailyOperationsDashboardKpis> {
  const { data, error } = await supabase.rpc('get_daily_operations_dashboard');
  if (error) throw new Error(error.message);
  return data as DailyOperationsDashboardKpis;
}

/**
 * Fetches enriched, paginated work queue items for the specified tab and filters
 */
export async function fetchDailyOperationsQueue(
  filters: DailyOperationsFilter = {}
): Promise<DailyOperationsQueueResponse> {
  const { data, error } = await supabase.rpc('get_daily_operations_queue', {
    p_tab: filters.tab || 'today',
    p_sub_filter: filters.subFilter || null,
    p_priority: filters.priority || null,
    p_search: filters.search || null,
    p_limit: filters.limit || 50,
    p_offset: filters.offset || 0,
  });

  if (error) throw new Error(error.message);
  return data as DailyOperationsQueueResponse;
}

/**
 * Creates a new CRM task idempotently with audit logging
 */
export async function createCrmTask(payload: {
  leadId: string;
  title: string;
  taskType?: TaskType;
  dueAt?: string | null;
  priority?: TaskPriority;
  description?: string;
  taskSource?: TaskSource;
  enrollmentId?: string;
  courseSessionId?: string;
  postCourseEngagementId?: string;
  idempotencyKey?: string;
}): Promise<{ success: boolean; task_id: string; already_existed?: boolean }> {
  const { data, error } = await supabase.rpc('create_crm_task', {
    p_lead_id: payload.leadId,
    p_title: payload.title,
    p_task_type: payload.taskType || 'general',
    p_due_at: payload.dueAt || null,
    p_priority: payload.priority || 'normal',
    p_description: payload.description || null,
    p_task_source: payload.taskSource || 'manual',
    p_enrollment_id: payload.enrollmentId || null,
    p_course_session_id: payload.courseSessionId || null,
    p_post_course_engagement_id: payload.postCourseEngagementId || null,
    p_idempotency_key: payload.idempotencyKey || null,
  });

  if (error) throw new Error(error.message);
  return data;
}

/**
 * Reschedules task due date with audit logging
 */
export async function rescheduleCrmTask(
  taskId: string,
  newDueAt: string | null,
  reason?: string
): Promise<{ success: boolean; task_id: string; old_due_at: string; new_due_at: string }> {
  const { data, error } = await supabase.rpc('reschedule_crm_task', {
    p_task_id: taskId,
    p_new_due_at: newDueAt,
    p_reason: reason || null,
  });

  if (error) throw new Error(error.message);
  return data;
}

/**
 * Completes task idempotently with audit logging
 */
export async function completeCrmTask(
  taskId: string,
  notes?: string,
  idempotencyKey?: string
): Promise<{ success: boolean; task_id: string; already_completed?: boolean }> {
  const { data, error } = await supabase.rpc('complete_crm_task', {
    p_task_id: taskId,
    p_notes: notes || null,
    p_idempotency_key: idempotencyKey || null,
  });

  if (error) throw new Error(error.message);
  return data;
}

// -----------------------------------------------------------------------------
// CSV Export Generators
// -----------------------------------------------------------------------------

/**
 * Exports current work queue view to standard CSV string
 */
export function exportWorkQueueCSV(items: WorkItem[]): string {
  const headers = [
    'ID',
    'Type',
    'Category',
    'Priority',
    'Title',
    'Description',
    'Due At',
    'Is Overdue',
    'Lead Name',
    'Lead Email',
    'Lead Phone',
    'Contact Preference',
    'Lead Score',
    'Pipeline Stage',
    'Reason Code',
  ];

  const rows = items.map((i) => [
    `"${i.id}"`,
    `"${i.type}"`,
    `"${i.category}"`,
    `"${i.priority}"`,
    `"${(i.title || '').replace(/"/g, '""')}"`,
    `"${(i.description || '').replace(/"/g, '""')}"`,
    `"${i.due_at ? i.due_at.slice(0, 16).replace('T', ' ') : ''}"`,
    `"${i.is_overdue ? 'YES' : 'NO'}"`,
    `"${(i.lead_name || '').replace(/"/g, '""')}"`,
    `"${(i.lead_email || '').replace(/"/g, '""')}"`,
    `"${(i.lead_phone || '').replace(/"/g, '""')}"`,
    `"${i.contact_preference || ''}"`,
    `"${i.lead_score ?? ''}"`,
    `"${i.pipeline_stage || ''}"`,
    `"${i.reason_code || ''}"`,
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

/**
 * Triggers a browser download of CSV content
 */
export function downloadCSV(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
