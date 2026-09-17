// =============================================================================
// Course Operations & Student Lifecycle Service
// =============================================================================
// Handles RPC calls and operations for course sessions, rosters, pre-course
// checklists, attendance, completion, and student lifecycle transitions.
// =============================================================================

import { supabase } from '../../../lib/supabase';
import type {
  CourseSession,
  CourseSessionStatus,
  AttendanceStatus,
  CompletionStatus,
  ChecklistItemStatus,
  NeedsAttentionReasonCode,
  CourseOperationsDashboardData,
  CourseSessionDetailData,
  CourseChecklistTemplate,
  Enrollment,
} from '../../../types/database';

export interface CreateOrUpdateSessionPayload {
  sessionId?: string;
  courseId: string;
  code: string;
  title: string;
  status: CourseSessionStatus;
  startDate: string;
  endDate: string;
  timezone?: string;
  capacity?: number | null;
  location?: string;
  instructorName?: string;
  notes?: string;
}

export interface AssignSessionPayload {
  enrollmentId: string;
  sessionId: string;
  idempotencyKey?: string;
}

export interface ChangeSessionPayload {
  enrollmentId: string;
  newSessionId: string;
  idempotencyKey?: string;
}

export interface RecordAttendancePayload {
  enrollmentId: string;
  attendanceStatus: AttendanceStatus;
  notes?: string;
}

export interface RecordCompletionPayload {
  enrollmentId: string;
  completionStatus: CompletionStatus;
  notes?: string;
}

export interface UpdateChecklistItemPayload {
  itemId: string;
  status: ChecklistItemStatus;
  notes?: string;
}

// -----------------------------------------------------------------------------
// Pure Business & Derivation Functions (Used by UI and Unit Tests)
// -----------------------------------------------------------------------------

/**
 * Derives available seats for a session based on capacity and confirmed enrollments.
 * If capacity is null, returns null (unlimited / N/A).
 * Formula: max(capacity - confirmed_enrollments, 0).
 */
export function deriveSessionAvailableSeats(
  capacity: number | null | undefined,
  confirmedEnrollmentsCount: number
): number | null {
  if (capacity === null || capacity === undefined) {
    return null;
  }
  return Math.max(capacity - Math.max(confirmedEnrollmentsCount, 0), 0);
}

/**
 * Checks if a session is at or over capacity.
 */
export function deriveSessionCapacityStatus(
  capacity: number | null | undefined,
  confirmedEnrollmentsCount: number
): { isAtCapacity: boolean; isOverCapacity: boolean } {
  if (capacity === null || capacity === undefined) {
    return { isAtCapacity: false, isOverCapacity: false };
  }
  return {
    isAtCapacity: confirmedEnrollmentsCount >= capacity,
    isOverCapacity: confirmedEnrollmentsCount > capacity,
  };
}

/**
 * Pure evaluation of whether a lead can safely transition from enrollment to post_course.
 * Rule: Lead must currently be in 'enrollment' stage, have at least one confirmed enrollment,
 * and CANNOT have any confirmed enrollment that:
 * A) has no course_session_id assigned
 * B) has session in draft/open/confirmed with end_date >= current_date
 * C) has participation completion_status != 'completed'
 * D) has future session (start_date > current_date)
 */
export function evaluatePostCourseTransitionEligibility(
  currentStageCode: string,
  enrollments: Array<{
    enrollment_status: string;
    course_session_id?: string | null;
    session?: {
      status: string;
      start_date: string;
      end_date: string;
    } | null;
    participation?: {
      completion_status: string;
    } | null;
  }>,
  currentDateStr: string = new Date().toISOString().slice(0, 10)
): { eligible: boolean; blockerReason?: string } {
  if (currentStageCode !== 'enrollment') {
    return {
      eligible: false,
      blockerReason: `Lead is in stage "${currentStageCode}", not "enrollment".`,
    };
  }

  const confirmed = enrollments.filter((e) => e.enrollment_status === 'confirmed');
  if (confirmed.length === 0) {
    return {
      eligible: false,
      blockerReason: 'Lead has no confirmed enrollments.',
    };
  }

  // Condition A: Confirmed enrollment without session assigned
  const unassigned = confirmed.find((e) => !e.course_session_id);
  if (unassigned) {
    return {
      eligible: false,
      blockerReason: 'Confirmed enrollment exists without assigned course session.',
    };
  }

  // Condition B: Active or future session not yet ended
  const ongoing = confirmed.find(
    (e) =>
      e.session &&
      ['draft', 'open', 'confirmed'].includes(e.session.status) &&
      e.session.end_date >= currentDateStr
  );
  if (ongoing) {
    return {
      eligible: false,
      blockerReason: 'Active or ongoing course session in progress.',
    };
  }

  // Condition C: Participation not completed
  const incomplete = confirmed.find(
    (e) => !e.participation || e.participation.completion_status !== 'completed'
  );
  if (incomplete) {
    return {
      eligible: false,
      blockerReason: 'One or more confirmed enrollments are not yet marked completed.',
    };
  }

  // Condition D: Another confirmed enrollment with future session
  const future = confirmed.find(
    (e) => e.session && e.session.start_date > currentDateStr
  );
  if (future) {
    return {
      eligible: false,
      blockerReason: 'Another confirmed enrollment has a future session.',
    };
  }

  return { eligible: true };
}

/**
 * Checks whether a lead qualifies as a Repeat Student:
 * Count of confirmed enrollments >= 2.
 */
export function isRepeatStudent(enrollments: Array<{ enrollment_status: string }>): boolean {
  const confirmedCount = enrollments.filter((e) => e.enrollment_status === 'confirmed').length;
  return confirmedCount >= 2;
}

/**
 * Derives operational needs attention reasons for an individual enrollment/student.
 */
export function deriveStudentNeedsAttention(params: {
  enrollmentStatus: string;
  hasSession: boolean;
  isSessionCancelled: boolean;
  sessionStartDate?: string;
  outstandingBalance: number;
  hasPendingRequiredChecklist: boolean;
  attendanceStatus?: AttendanceStatus;
  readinessWindowDays?: number;
  currentDateStr?: string;
}): NeedsAttentionReasonCode[] {
  const {
    enrollmentStatus,
    hasSession,
    isSessionCancelled,
    sessionStartDate,
    outstandingBalance,
    hasPendingRequiredChecklist,
    attendanceStatus,
    readinessWindowDays = 14,
    currentDateStr = new Date().toISOString().slice(0, 10),
  } = params;

  if (enrollmentStatus !== 'confirmed') {
    return [];
  }

  const reasons: NeedsAttentionReasonCode[] = [];

  if (!hasSession) {
    reasons.push('ENROLLMENT_WITHOUT_SESSION');
  }

  if (isSessionCancelled) {
    reasons.push('SESSION_CANCELLED_REASSIGNMENT_REQUIRED');
  }

  if (outstandingBalance > 0) {
    reasons.push('PAYMENT_OUTSTANDING');
  }

  if (hasPendingRequiredChecklist) {
    reasons.push('MISSING_REQUIRED_ITEM');
  }

  if (sessionStartDate && hasPendingRequiredChecklist) {
    const start = new Date(sessionStartDate).getTime();
    const now = new Date(currentDateStr).getTime();
    const diffDays = Math.ceil((start - now) / (1000 * 60 * 60 * 24));
    if (diffDays >= 0 && diffDays <= readinessWindowDays) {
      reasons.push('UPCOMING_SESSION_UNREADY');
    }
  }

  if (attendanceStatus === 'no_show') {
    reasons.push('NO_SHOW');
  }

  return reasons;
}

// -----------------------------------------------------------------------------
// Server RPC & API Invocations
// -----------------------------------------------------------------------------

/**
 * Fetches the aggregated Course Operations Dashboard dataset in a single call.
 */
export async function fetchCourseOperationsDashboard(): Promise<CourseOperationsDashboardData> {
  const { data, error } = await supabase.rpc('get_course_operations_dashboard');

  if (error) {
    console.error('Error fetching course operations dashboard:', error);
    throw new Error(error.message || 'Failed to fetch course operations dashboard');
  }

  return data as CourseOperationsDashboardData;
}

/**
 * Fetches the full Course Session Detail with Student Roster without N+1 queries.
 */
export async function fetchCourseSessionDetail(sessionId: string): Promise<CourseSessionDetailData> {
  const { data, error } = await supabase.rpc('get_course_session_detail', {
    p_session_id: sessionId,
  });

  if (error) {
    console.error(`Error fetching session detail for ${sessionId}:`, error);
    throw new Error(error.message || 'Failed to fetch session detail');
  }

  return data as CourseSessionDetailData;
}

/**
 * Creates or updates a course session via transactional RPC.
 */
export async function createOrUpdateCourseSession(
  payload: CreateOrUpdateSessionPayload
): Promise<{ success: boolean; session_id: string }> {
  const { data, error } = await supabase.rpc('create_or_update_course_session', {
    p_session_id: payload.sessionId || null,
    p_course_id: payload.courseId,
    p_code: payload.code,
    p_title: payload.title,
    p_status: payload.status,
    p_start_date: payload.startDate,
    p_end_date: payload.endDate,
    p_timezone: payload.timezone || 'America/New_York',
    p_capacity: payload.capacity ?? null,
    p_location: payload.location || 'Orlando, FL',
    p_instructor_name: payload.instructorName || null,
    p_notes: payload.notes || null,
  });

  if (error) {
    console.error('Error in create_or_update_course_session:', error);
    throw new Error(error.message || 'Failed to save course session');
  }

  return data;
}

/**
 * Assigns a confirmed enrollment to a course session transactionally.
 * Creates participation, instantiates checklist items snapshot, logs activity, and emits event.
 */
export async function assignEnrollmentToSession(
  payload: AssignSessionPayload
): Promise<{
  success: boolean;
  enrollment_id: string;
  session_id: string;
  checklist_items_created: number;
  idempotent_replay: boolean;
}> {
  const { data, error } = await supabase.rpc('assign_enrollment_to_session', {
    p_enrollment_id: payload.enrollmentId,
    p_session_id: payload.sessionId,
    p_idempotency_key: payload.idempotencyKey || null,
  });

  if (error) {
    console.error('Error in assign_enrollment_to_session:', error);
    throw new Error(error.message || 'Failed to assign enrollment to session');
  }

  return data;
}

/**
 * Transfers an enrollment from its current session to a new session.
 */
export async function changeEnrollmentSession(
  payload: ChangeSessionPayload
): Promise<{
  success: boolean;
  enrollment_id: string;
  old_session_id: string | null;
  new_session_id: string;
  idempotent_replay: boolean;
}> {
  const { data, error } = await supabase.rpc('change_enrollment_session', {
    p_enrollment_id: payload.enrollmentId,
    p_new_session_id: payload.newSessionId,
    p_idempotency_key: payload.idempotencyKey || null,
  });

  if (error) {
    console.error('Error in change_enrollment_session:', error);
    throw new Error(error.message || 'Failed to change enrollment session');
  }

  return data;
}

/**
 * Records attendance status for a student in a session.
 */
export async function recordCourseAttendance(
  payload: RecordAttendancePayload
): Promise<{ success: boolean; enrollment_id: string; attendance_status: AttendanceStatus }> {
  const { data, error } = await supabase.rpc('record_course_attendance', {
    p_enrollment_id: payload.enrollmentId,
    p_attendance_status: payload.attendanceStatus,
    p_notes: payload.notes || null,
  });

  if (error) {
    console.error('Error in record_course_attendance:', error);
    throw new Error(error.message || 'Failed to record course attendance');
  }

  return data;
}

/**
 * Records completion status for a student in a session.
 * Automatically triggers safe post-course transition evaluation if completed.
 */
export async function recordCourseCompletion(
  payload: RecordCompletionPayload
): Promise<{
  success: boolean;
  enrollment_id: string;
  completion_status: CompletionStatus;
  pipeline_evaluation?: {
    eligible: boolean;
    moved: boolean;
    current_stage: string;
    reason?: string;
  };
}> {
  const { data, error } = await supabase.rpc('record_course_completion', {
    p_enrollment_id: payload.enrollmentId,
    p_completion_status: payload.completionStatus,
    p_notes: payload.notes || null,
  });

  if (error) {
    console.error('Error in record_course_completion:', error);
    throw new Error(error.message || 'Failed to record course completion');
  }

  return data;
}

/**
 * Updates an individual checklist item (pending, completed, waived).
 */
export async function updateStudentChecklistItem(
  payload: UpdateChecklistItemPayload
): Promise<{ success: boolean; item_id: string; status: ChecklistItemStatus }> {
  const { data, error } = await supabase.rpc('update_student_checklist_item', {
    p_item_id: payload.itemId,
    p_status: payload.status,
    p_notes: payload.notes || null,
  });

  if (error) {
    console.error('Error in update_student_checklist_item:', error);
    throw new Error(error.message || 'Failed to update student checklist item');
  }

  return data;
}

/**
 * Server-side evaluation of lead transition to post_course.
 */
export async function evaluateLeadPostCourseTransition(leadId: string): Promise<{
  eligible: boolean;
  moved: boolean;
  current_stage: string;
  reason?: string;
  message?: string;
}> {
  const { data, error } = await supabase.rpc('evaluate_lead_post_course_transition', {
    p_lead_id: leadId,
  });

  if (error) {
    console.error('Error evaluating post-course transition:', error);
    throw new Error(error.message || 'Failed to evaluate post-course transition');
  }

  return data;
}

/**
 * Fetches available sessions for a course (for assignment dropdowns).
 */
export async function fetchAvailableSessionsForCourse(courseId: string): Promise<CourseSession[]> {
  const { data, error } = await supabase
    .from('course_sessions')
    .select('*')
    .eq('course_id', courseId)
    .in('status', ['open', 'confirmed', 'draft'])
    .order('start_date', { ascending: true });

  if (error) {
    console.error(`Error fetching sessions for course ${courseId}:`, error);
    throw new Error(error.message || 'Failed to fetch course sessions');
  }

  return (data || []) as CourseSession[];
}

/**
 * Fetches all course sessions with optional status filter.
 */
export async function fetchAllCourseSessions(status?: CourseSessionStatus): Promise<CourseSession[]> {
  let query = supabase
    .from('course_sessions')
    .select('*, course:courses(id, code, name, default_price, currency)')
    .order('start_date', { ascending: false });

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching course sessions:', error);
    throw new Error(error.message || 'Failed to fetch course sessions');
  }

  return (data || []) as CourseSession[];
}

/**
 * Fetches pre-course checklist templates.
 */
export async function fetchChecklistTemplates(courseId?: string): Promise<CourseChecklistTemplate[]> {
  let query = supabase
    .from('course_checklist_templates')
    .select('*')
    .eq('active', true)
    .order('sort_order', { ascending: true });

  if (courseId) {
    query = query.or(`course_id.is.null,course_id.eq.${courseId}`);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching checklist templates:', error);
    throw new Error(error.message || 'Failed to fetch checklist templates');
  }

  return (data || []) as CourseChecklistTemplate[];
}

/**
 * Fetches student's full course history for Lead Detail page.
 */
export async function fetchLeadCourseHistory(leadId: string): Promise<Enrollment[]> {
  const { data, error } = await supabase
    .from('enrollments')
    .select(`
      *,
      course:courses(id, code, name, default_price, currency),
      session:course_sessions(id, code, title, status, start_date, end_date, timezone, location, instructor_name),
      participation:course_participations(id, attendance_status, completion_status, completed_at, notes),
      payments:enrollment_payments(id, amount, payment_status, payment_type, payment_date, payment_method)
    `)
    .eq('lead_id', leadId)
    .order('enrollment_date', { ascending: false });

  if (error) {
    console.error(`Error fetching course history for lead ${leadId}:`, error);
    throw new Error(error.message || 'Failed to fetch lead course history');
  }

  return (data || []) as Enrollment[];
}

// -----------------------------------------------------------------------------
// CSV Exports
// -----------------------------------------------------------------------------

/**
 * Exports a session roster to CSV and triggers browser download.
 */
export function exportRosterToCsv(
  session: { code: string; title: string; start_date: string },
  roster: Array<{
    student_name: string;
    student_email: string | null;
    student_phone: string | null;
    enrollment_status: string;
    agreed_amount: number;
    net_paid: number;
    outstanding_balance: number;
    payment_status_derived: string;
    attendance_status: string;
    completion_status: string;
    repeat_student: boolean;
    checklist_completed: number;
    checklist_total: number;
  }>
): void {
  const headers = [
    'Student Name',
    'Email',
    'Phone',
    'Enrollment Status',
    'Agreed Amount',
    'Net Paid',
    'Balance',
    'Payment Status',
    'Attendance',
    'Completion',
    'Repeat Student',
    'Checklist Progress',
  ];

  const rows = roster.map((s) => [
    `"${(s.student_name || '').replace(/"/g, '""')}"`,
    `"${(s.student_email || '').replace(/"/g, '""')}"`,
    `"${(s.student_phone || '').replace(/"/g, '""')}"`,
    s.enrollment_status,
    s.agreed_amount.toFixed(2),
    s.net_paid.toFixed(2),
    s.outstanding_balance.toFixed(2),
    s.payment_status_derived,
    s.attendance_status,
    s.completion_status,
    s.repeat_student ? 'Yes' : 'No',
    `"${s.checklist_completed}/${s.checklist_total}"`,
  ]);

  const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute(
    'download',
    `session_roster_${session.code || 'export'}_${new Date().toISOString().slice(0, 10)}.csv`
  );
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
