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

/**
 * Sorts work items canonically according to the priority hierarchy:
 * 1. OVERDUE FIRST (is_overdue = true ahead of is_overdue = false)
 * 2. Priority: critical -> high -> normal -> low
 * 3. Earliest due date (due_at ASC NULLS LAST)
 * 4. Oldest waiting / created_at (detected_at ASC)
 * 5. Deterministic ID tiebreaker
 */
export function sortWorkItems(items: WorkItem[]): WorkItem[] {
  const priorityRank: Record<TaskPriority, number> = {
    critical: 1,
    high: 2,
    normal: 3,
    low: 4,
  };

  return [...items].sort((a, b) => {
    // 1. OVERDUE FIRST
    if (a.is_overdue !== b.is_overdue) {
      return a.is_overdue ? -1 : 1;
    }

    // 2. Priority deterministic order
    const pA = priorityRank[a.priority] || 5;
    const pB = priorityRank[b.priority] || 5;
    if (pA !== pB) return pA - pB;

    // 3. Earliest due date (nulls last)
    if (a.due_at && b.due_at) {
      const diff = new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
      if (diff !== 0) return diff;
    } else if (a.due_at && !b.due_at) {
      return -1;
    } else if (!a.due_at && b.due_at) {
      return 1;
    }

    // 4. Oldest waiting / created_at (earliest detected_at first)
    const tA = a.detected_at ? new Date(a.detected_at).getTime() : 0;
    const tB = b.detected_at ? new Date(b.detected_at).getTime() : 0;
    if (tA !== tB) return tA - tB;

    // 5. Deterministic ID tiebreaker
    return a.id.localeCompare(b.id);
  });
}

// -----------------------------------------------------------------------------
// Database & RPC Invocations
// -----------------------------------------------------------------------------

/**
 * Directly computes KPI metrics from public.tasks and public.conversations
 * without relying on missing public.lead_scores relation.
 */
export async function fetchDailyOperationsDashboardDirect(): Promise<DailyOperationsDashboardKpis> {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

  try {
    const [
      { count: dueTodayCount },
      { count: overdueCount },
      { count: completedTodayCount },
      { count: paymentsCount },
      { count: coursesCount },
      { count: needsReplyCount },
    ] = await Promise.all([
      supabase.from('tasks').select('*', { count: 'exact', head: true }).eq('status', 'pending').gte('due_at', startOfDay).lt('due_at', endOfDay),
      supabase.from('tasks').select('*', { count: 'exact', head: true }).eq('status', 'pending').lt('due_at', now.toISOString()),
      supabase.from('tasks').select('*', { count: 'exact', head: true }).eq('status', 'completed').gte('completed_at', startOfDay).lt('completed_at', endOfDay),
      supabase.from('tasks').select('*', { count: 'exact', head: true }).eq('status', 'pending').eq('task_type', 'payment'),
      supabase.from('tasks').select('*', { count: 'exact', head: true }).eq('status', 'pending').not('course_session_id', 'is', null),
      supabase.from('conversations').select('*', { count: 'exact', head: true }).eq('status', 'open').eq('last_message_direction', 'inbound'),
    ]);

    return {
      timezone: 'America/New_York',
      hot_min_threshold: 50,
      stale_after_days: 7,
      due_today_count: dueTodayCount ?? 0,
      overdue_count: overdueCount ?? 0,
      completed_today_count: completedTodayCount ?? 0,
      needs_reply_count: needsReplyCount ?? 0,
      hot_leads_count: 0,
      leads_no_next_action_count: 0,
      stale_leads_count: 0,
      course_attention_count: coursesCount ?? 0,
      payment_attention_count: paymentsCount ?? 0,
      post_course_attention_count: 0,
      total_actionable_items: (dueTodayCount ?? 0) + (overdueCount ?? 0) + (needsReplyCount ?? 0),
    };
  } catch (err) {
    console.error('[fetchDailyOperationsDashboardDirect] Failed to compute dashboard metrics:', err);
    return {
      timezone: 'America/New_York',
      hot_min_threshold: 50,
      stale_after_days: 7,
      due_today_count: 0,
      overdue_count: 0,
      completed_today_count: 0,
      needs_reply_count: 0,
      hot_leads_count: 0,
      leads_no_next_action_count: 0,
      stale_leads_count: 0,
      course_attention_count: 0,
      payment_attention_count: 0,
      post_course_attention_count: 0,
      total_actionable_items: 0,
    };
  }
}

/**
 * Fetches KPIs and summary counts for Daily Operations dashboard.
 * Failsafe: Falls back to direct tasks queries if RPC is unavailable.
 */
export async function fetchDailyOperationsDashboard(): Promise<DailyOperationsDashboardKpis> {
  try {
    const { data, error } = await supabase.rpc('get_daily_operations_dashboard');
    if (!error && data && typeof data === 'object') {
      return data as DailyOperationsDashboardKpis;
    }
    return await fetchDailyOperationsDashboardDirect();
  } catch {
    return await fetchDailyOperationsDashboardDirect();
  }
}

/**
 * Directly queries public.tasks with joined leads and pipeline stages,
 * eliminating the broken public.lead_scores dependency.
 */
export async function fetchDailyOperationsQueueDirect(
  filters: DailyOperationsFilter = {}
): Promise<DailyOperationsQueueResponse> {
  const tab = filters.tab || 'today';
  const limit = filters.limit || 50;
  const offset = filters.offset || 0;

  let query = supabase
    .from('tasks')
    .select(`
      id,
      lead_id,
      task_type,
      title,
      description,
      status,
      due_at,
      priority,
      task_source,
      created_at,
      updated_at,
      completed_at,
      course_session_id,
      lead:leads (
        id,
        first_name,
        last_name,
        email,
        phone_raw,
        phone_e164,
        contact_preference,
        pipeline_stage:pipeline_stages (
          id,
          name,
          code
        )
      )
    `, { count: 'exact' });

  const nowIso = new Date().toISOString();
  const nowDate = new Date();
  const endOfDay = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() + 1).toISOString();

  // Tab-specific filters
  if (tab === 'today') {
    query = query.eq('status', 'pending').or(`due_at.lte.${endOfDay},due_at.is.null`);
  } else if (tab === 'overdue') {
    query = query.eq('status', 'pending').lt('due_at', nowIso);
  } else if (tab === 'completed') {
    query = query.eq('status', 'completed');
  } else if (tab === 'payments') {
    query = query.eq('task_type', 'payment');
  } else if (tab === 'courses') {
    query = query.or('course_session_id.not.is.null,task_type.eq.course_ops');
  } else if (tab === 'leads') {
    query = query.eq('status', 'pending');
  } else if (tab === 'needs_reply') {
    query = query.eq('status', 'pending');
  }

  if (filters.priority) {
    query = query.eq('priority', filters.priority);
  }

  // Ordering
  if (tab === 'completed') {
    query = query.order('completed_at', { ascending: false, nullsFirst: false });
  } else if (tab === 'overdue') {
    query = query.order('due_at', { ascending: true, nullsFirst: false });
  } else {
    query = query.order('due_at', { ascending: true, nullsFirst: false }).order('created_at', { ascending: true });
  }

  query = query.range(offset, offset + limit - 1);

  const { data, count, error } = await query;
  if (error) {
    console.error('[fetchDailyOperationsQueueDirect] Error querying tasks directly:', error);
    return {
      tab,
      total_count: 0,
      items: [],
      page: Math.floor(offset / limit) + 1,
      page_size: limit,
    } as any;
  }

  const rawTasks = data || [];
  let items: WorkItem[] = rawTasks.map((t: any) => {
    const lead = t.lead;
    const leadName = lead
      ? `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || lead.email || 'Lead'
      : null;
    const isOverdue = t.status !== 'completed' && t.due_at ? new Date(t.due_at).getTime() < Date.now() : false;

    let itemType: any = 'TASK';
    if (t.task_type === 'payment') itemType = 'PAYMENT_ATTENTION';
    else if (t.course_session_id || t.task_type === 'course_ops') itemType = 'COURSE_ATTENTION';

    return {
      id: `task:${t.id}`,
      type: itemType,
      category: tab as any,
      priority: t.priority || 'normal',
      title: t.title,
      description: t.description || null,
      due_at: t.due_at || null,
      is_overdue: isOverdue,
      detected_at: t.created_at,
      lead_id: t.lead_id,
      lead_name: leadName,
      lead_email: lead?.email || null,
      lead_phone: lead?.phone_e164 || lead?.phone_raw || null,
      contact_preference: lead?.contact_preference || null,
      lead_score: null, // Zero dependency on missing public.lead_scores relation
      pipeline_stage: lead?.pipeline_stage?.name || null,
      reason_code: null,
      context_id: t.id,
      context_type: 'task',
      primary_action: {
        type: 'complete_task',
        label: 'Marcar como concluída',
        task_id: t.id,
      },
    };
  });

  // Client-side search filtering
  if (filters.search && filters.search.trim()) {
    const q = filters.search.toLowerCase().trim();
    items = items.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        (item.description && item.description.toLowerCase().includes(q)) ||
        (item.lead_name && item.lead_name.toLowerCase().includes(q)) ||
        (item.lead_email && item.lead_email.toLowerCase().includes(q)) ||
        (item.lead_phone && item.lead_phone.includes(q))
    );
  }

  return {
    tab,
    total_count: count ?? items.length,
    items: sortWorkItems(items),
    page: Math.floor(offset / limit) + 1,
    page_size: limit,
  } as any;
}

/**
 * Fetches enriched, paginated work queue items for the specified tab and filters.
 * Seamlessly falls back to direct tasks queries if get_daily_operations_queue
 * fails or throws (e.g., due to missing public.lead_scores relation).
 */
export async function fetchDailyOperationsQueue(
  filters: DailyOperationsFilter = {}
): Promise<DailyOperationsQueueResponse> {
  try {
    const { data, error } = await supabase.rpc('get_daily_operations_queue', {
      p_tab: filters.tab || 'today',
      p_sub_filter: filters.subFilter || null,
      p_priority: filters.priority || null,
      p_search: filters.search || null,
      p_limit: filters.limit || 50,
      p_offset: filters.offset || 0,
    });

    if (!error && data && Array.isArray((data as any).items)) {
      const response = data as DailyOperationsQueueResponse;
      return {
        ...response,
        items: sortWorkItems(response.items || []),
      };
    }

    // Direct fallback removes public.lead_scores dependency completely
    return await fetchDailyOperationsQueueDirect(filters);
  } catch {
    return await fetchDailyOperationsQueueDirect(filters);
  }
}

/**
 * Creates a new CRM task idempotently with audit logging.
 * Enforces task_source = 'manual' to prevent spoofing from UI/client.
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
  // Always enforce 'manual' task source for user-created CRM tasks
  const { data, error } = await supabase.rpc('create_crm_task', {
    p_lead_id: payload.leadId,
    p_title: payload.title,
    p_task_type: payload.taskType || 'general',
    p_due_at: payload.dueAt || null,
    p_priority: payload.priority || 'normal',
    p_description: payload.description || null,
    p_task_source: 'manual', // Client cannot spoof provenance
    p_enrollment_id: payload.enrollmentId || null,
    p_course_session_id: payload.courseSessionId || null,
    p_post_course_engagement_id: payload.postCourseEngagementId || null,
    p_idempotency_key: payload.idempotencyKey || null,
  });

  if (error) throw new Error(error.message);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('tasks-updated'));
    window.dispatchEvent(new CustomEvent('lead-updated', { detail: { leadId: payload.leadId } }));
  }

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

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('tasks-updated'));
    window.dispatchEvent(new CustomEvent('lead-updated'));
  }

  return data;
}

/**
 * Completes task idempotently with audit logging.
 * Normalizes task ID (stripping any task: prefix) and uses resilient multi-layer
 * persistence (canonical RPC first, falling back to direct public.tasks update).
 */
export async function completeCrmTask(
  taskId: string,
  notes?: string,
  idempotencyKey?: string
): Promise<{ success: boolean; task_id: string; already_completed?: boolean }> {
  const cleanTaskId = (taskId || '').replace(/^task:/i, '').trim();
  if (!cleanTaskId) {
    throw new Error('Task ID is required');
  }

  let completedSuccessfully = false;
  let alreadyCompleted = false;

  // 1. Primary Attempt: Canonical RPC with transactional audit logging
  try {
    const { data, error } = await supabase.rpc('complete_crm_task', {
      p_task_id: cleanTaskId,
      p_notes: notes || null,
      p_idempotency_key: idempotencyKey || null,
    });

    if (!error && data !== null && data !== undefined) {
      completedSuccessfully = true;
      if (typeof data === 'boolean') {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('tasks-updated', { detail: { taskId: cleanTaskId } }));
          window.dispatchEvent(new CustomEvent('lead-updated', { detail: { taskId: cleanTaskId } }));
        }
        return data as any;
      }
      alreadyCompleted = Boolean(data.already_completed);
    } else if (error) {
      console.warn('[completeCrmTask] RPC execution failed, evaluating direct update fallback:', error.message);
    }
  } catch (rpcErr) {
    console.warn('[completeCrmTask] RPC invocation threw error, evaluating direct update fallback:', rpcErr);
  }

  // 2. Resilient Fallback: Direct table update if RPC is unavailable or failed
  if (!completedSuccessfully) {
    const nowIso = new Date().toISOString();
    const { data: updateData, error: updateError } = await supabase
      .from('tasks')
      .update({
        status: 'completed',
        completed_at: nowIso,
        updated_at: nowIso,
      })
      .eq('id', cleanTaskId)
      .select('id, lead_id, title, status, completed_at');

    if (updateError) {
      console.error('[completeCrmTask] Direct table update failed:', updateError);
      throw new Error(updateError.message || 'Não foi possível concluir a tarefa.');
    }

    if (!updateData || updateData.length === 0) {
      console.error('[completeCrmTask] Task not found for ID:', cleanTaskId);
      throw new Error('Task not found: ' + cleanTaskId);
    }

    completedSuccessfully = true;

    // Best-effort audit logging for fallback execution (non-blocking)
    try {
      const updatedTask = updateData[0];
      const { data: authData } = await supabase.auth.getUser();
      const currentUserId = authData?.user?.id || null;

      if (updatedTask.lead_id) {
        await supabase.from('lead_activities').insert({
          lead_id: updatedTask.lead_id,
          activity_type: 'task_completed',
          actor_type: 'user',
          actor_id: currentUserId,
          summary: `Task completed: ${updatedTask.title || 'Tarefa'}`,
          metadata: {
            task_id: cleanTaskId,
            notes: notes || null,
            idempotency_key: idempotencyKey || null,
            fallback_completed: true,
          },
        });
      }
    } catch (auditErr) {
      console.warn('[completeCrmTask] Non-blocking audit log notice:', auditErr);
    }
  }

  // 3. Global Synchronous Events for instantaneous UI synchronization
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('tasks-updated', { detail: { taskId: cleanTaskId } }));
    window.dispatchEvent(new CustomEvent('lead-updated', { detail: { taskId: cleanTaskId } }));
  }

  return {
    success: true,
    task_id: cleanTaskId,
    already_completed: alreadyCompleted,
  };
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
