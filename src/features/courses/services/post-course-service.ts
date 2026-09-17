// =============================================================================
// Post-Course & Alumni Service (Phase 4 Block 5)
// =============================================================================

import { supabase } from '../../../lib/supabase';
import type {
  PostCourseDashboardData,
  PostCourseFollowupStatus,
  TestimonialStatus,
  TestimonialConsentStatus,
  FutureInterestSource,
  PostCourseFollowupQueueItem,
  TestimonialOpportunityItem,
  NextCourseOpportunityItem,
  AlumniDirectoryItem,
} from '../../../types/database';

// -----------------------------------------------------------------------------
// Pure Business & Metric Derivation Functions
// -----------------------------------------------------------------------------

/**
 * Calculates feedback response rate:
 * unique completed enrollments with feedback received / unique completed enrollments where feedback was requested
 * If denominator == 0, returns null ("No data")
 */
export function deriveFeedbackResponseRate(
  receivedCount: number,
  requestedCount: number
): number | null {
  if (!requestedCount || requestedCount <= 0) return null;
  const rate = (receivedCount / requestedCount) * 100;
  return Number(rate.toFixed(1));
}

/**
 * Calculates testimonial response rate:
 * received testimonials / requested testimonials
 * If denominator == 0, returns null ("No data")
 */
export function deriveTestimonialResponseRate(
  receivedCount: number,
  requestedCount: number
): number | null {
  if (!requestedCount || requestedCount <= 0) return null;
  const rate = (receivedCount / requestedCount) * 100;
  return Number(rate.toFixed(1));
}

/**
 * Calculates repeat student rate:
 * unique leads with >= 2 confirmed enrollments / unique leads with >= 1 confirmed enrollment (snapshot)
 * If denominator == 0, returns null
 */
export function deriveRepeatStudentRate(
  repeatStudentsCount: number,
  totalConfirmedStudentsCount: number
): number | null {
  if (!totalConfirmedStudentsCount || totalConfirmedStudentsCount <= 0) return null;
  const rate = (repeatStudentsCount / totalConfirmedStudentsCount) * 100;
  return Number(rate.toFixed(1));
}

/**
 * Checks if a post-course engagement qualifies as a testimonial opportunity:
 * Criterion: Course completed + Feedback received + Testimonial not_requested
 */
export function isTestimonialOpportunity(engagement: {
  feedback_status: string;
  testimonial_status: string;
}): boolean {
  return (
    engagement.feedback_status === 'received' &&
    engagement.testimonial_status === 'not_requested'
  );
}

/**
 * Checks if a future course interest qualifies as a next-course commercial opportunity:
 * Criterion: Status is active AND student has no confirmed enrollment for that target course
 */
export function isNextCourseOpportunity(
  interest: { status: string; course_id: string },
  confirmedEnrollmentCourseIds: string[]
): boolean {
  if (interest.status !== 'active') return false;
  return !confirmedEnrollmentCourseIds.includes(interest.course_id);
}

/**
 * Checks if a post-course follow-up is overdue
 */
export function derivePostCourseFollowupOverdue(
  engagement: { followup_status: string; followup_due_at: string },
  nowIso?: string
): boolean {
  if (engagement.followup_status !== 'pending') return false;
  const now = new Date(nowIso || new Date().toISOString()).getTime();
  const due = new Date(engagement.followup_due_at).getTime();
  return due < now;
}

/**
 * Checks if feedback response is pending overdue based on requested date and window days
 */
export function deriveFeedbackPending(
  engagement: { feedback_status: string; feedback_requested_at: string | null },
  windowDays = 7,
  nowIso?: string
): boolean {
  if (engagement.feedback_status !== 'requested' || !engagement.feedback_requested_at) return false;
  const now = new Date(nowIso || new Date().toISOString()).getTime();
  const reqTime = new Date(engagement.feedback_requested_at).getTime();
  return reqTime + windowDays * 86400000 < now;
}

/**
 * Testimonial request due: feedback received and testimonial not yet requested
 */
export function deriveTestimonialRequestDue(engagement: {
  feedback_status: string;
  testimonial_status: string;
}): boolean {
  return (
    engagement.feedback_status === 'received' &&
    engagement.testimonial_status === 'not_requested'
  );
}

// -----------------------------------------------------------------------------
// Database & RPC Invocations
// -----------------------------------------------------------------------------

/**
 * Fetches all Post-Course & Alumni dashboard data in a single RPC aggregator
 */
export async function fetchPostCourseDashboard(): Promise<PostCourseDashboardData> {
  const { data, error } = await supabase.rpc('get_post_course_dashboard');
  if (error) throw new Error(error.message);
  return data as PostCourseDashboardData;
}

/**
 * Completes post-course follow-up explicitly and idempotently
 */
export async function completeFollowup(
  engagementId: string,
  notes?: string,
  idempotencyKey?: string
): Promise<{ success: boolean; engagement_id: string; followup_status: string }> {
  const { data, error } = await supabase.rpc('complete_post_course_followup', {
    p_engagement_id: engagementId,
    p_notes: notes || null,
    p_idempotency_key: idempotencyKey || null,
  });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Updates post-course engagement follow-up status (e.g. in_progress, skipped)
 */
export async function updateEngagementStatus(
  engagementId: string,
  followupStatus: PostCourseFollowupStatus,
  notes?: string
): Promise<{ success: boolean }> {
  const { data, error } = await supabase.rpc('update_post_course_engagement', {
    p_engagement_id: engagementId,
    p_followup_status: followupStatus,
    p_notes: notes || null,
  });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Generates an unguessable single-use feedback link token
 */
export async function generateFeedbackToken(
  engagementId: string,
  expiresInDays = 30
): Promise<{ raw_token: string; expires_at: string }> {
  const { data, error } = await supabase.rpc('create_post_course_feedback_token', {
    p_engagement_id: engagementId,
    p_expires_in_days: expiresInDays,
  });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Records testimonial status and explicit consent
 */
export async function recordTestimonial(
  engagementId: string,
  status: TestimonialStatus,
  notes?: string,
  consentStatus: TestimonialConsentStatus = 'unknown'
): Promise<{ success: boolean }> {
  const { data, error } = await supabase.rpc('record_post_course_testimonial', {
    p_engagement_id: engagementId,
    p_status: status,
    p_notes: notes || null,
    p_consent_status: consentStatus,
  });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Records a normalized future course interest and creates commercial task handoff
 */
export async function recordFutureInterest(params: {
  leadId: string;
  courseId: string;
  source?: FutureInterestSource;
  sourceEnrollmentId?: string;
  engagementId?: string;
  notes?: string;
}): Promise<{ success: boolean; interest_id: string; task_id?: string }> {
  const { data, error } = await supabase.rpc('record_future_course_interest', {
    p_lead_id: params.leadId,
    p_course_id: params.courseId,
    p_source: params.source || 'post_course',
    p_source_enrollment_id: params.sourceEnrollmentId || null,
    p_engagement_id: params.engagementId || null,
    p_notes: params.notes || null,
  });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Promotes a lead to Alumni stage manually with safety checks
 */
export async function moveLeadToAlumni(
  leadId: string,
  note?: string
): Promise<{ success: boolean; has_future_session?: boolean }> {
  const { data, error } = await supabase.rpc('move_lead_to_alumni', {
    p_lead_id: leadId,
    p_note: note || null,
  });
  if (error) throw new Error(error.message);
  return data;
}

// -----------------------------------------------------------------------------
// CSV Exports
// -----------------------------------------------------------------------------

export function exportFollowupsCSV(items: PostCourseFollowupQueueItem[]): string {
  const headers = [
    'Student Name',
    'Email',
    'Phone',
    'Contact Preference',
    'Course',
    'Session',
    'Completion Date',
    'Follow-Up Status',
    'Follow-Up Due',
    'Is Overdue',
    'Notes',
  ];

  const rows = items.map((i) => [
    `"${(i.student_name || '').replace(/"/g, '""')}"`,
    `"${(i.student_email || '').replace(/"/g, '""')}"`,
    `"${(i.student_phone || '').replace(/"/g, '""')}"`,
    `"${i.contact_preference || ''}"`,
    `"${(i.course_name || '').replace(/"/g, '""')}"`,
    `"${i.session_code || ''}"`,
    `"${i.completed_at ? i.completed_at.slice(0, 10) : ''}"`,
    `"${i.followup_status}"`,
    `"${i.followup_due_at ? i.followup_due_at.slice(0, 10) : ''}"`,
    `"${i.is_overdue ? 'YES' : 'NO'}"`,
    `"${(i.notes || '').replace(/"/g, '""')}"`,
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

export function exportTestimonialOpportunitiesCSV(items: TestimonialOpportunityItem[]): string {
  const headers = [
    'Student Name',
    'Email',
    'Course',
    'Session',
    'Feedback Status',
    'Feedback Received At',
    'Testimonial Status',
    'Consent Status',
    'Testimonial Notes',
  ];

  const rows = items.map((i) => [
    `"${(i.student_name || '').replace(/"/g, '""')}"`,
    `"${(i.student_email || '').replace(/"/g, '""')}"`,
    `"${(i.course_name || '').replace(/"/g, '""')}"`,
    `"${i.session_code || ''}"`,
    `"${i.feedback_status}"`,
    `"${i.feedback_received_at ? i.feedback_received_at.slice(0, 10) : ''}"`,
    `"${i.testimonial_status}"`,
    `"${i.testimonial_consent_status}"`,
    `"${(i.testimonial_notes || '').replace(/"/g, '""')}"`,
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

export function exportNextCourseOpportunitiesCSV(items: NextCourseOpportunityItem[]): string {
  const headers = [
    'Student Name',
    'Email',
    'Phone',
    'Contact Preference',
    'Target Course',
    'Price',
    'Completed Course',
    'Source',
    'Status',
    'Date Expressed',
    'Notes',
  ];

  const rows = items.map((i) => [
    `"${(i.student_name || '').replace(/"/g, '""')}"`,
    `"${(i.student_email || '').replace(/"/g, '""')}"`,
    `"${(i.student_phone || '').replace(/"/g, '""')}"`,
    `"${i.contact_preference || ''}"`,
    `"${(i.target_course_name || '').replace(/"/g, '""')}"`,
    `"${i.default_price != null ? i.default_price : ''}"`,
    `"${(i.completed_course_name || '').replace(/"/g, '""')}"`,
    `"${i.source}"`,
    `"${i.status}"`,
    `"${i.created_at ? i.created_at.slice(0, 10) : ''}"`,
    `"${(i.notes || '').replace(/"/g, '""')}"`,
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

export function exportAlumniDirectoryCSV(items: AlumniDirectoryItem[]): string {
  const headers = [
    'Student Name',
    'Email',
    'Phone',
    'Member Since',
    'Confirmed Enrollments',
    'Repeat Student',
    'Total Spend',
    'Last Completed Date',
    'Current Interest',
  ];

  const rows = items.map((i) => [
    `"${(i.student_name || '').replace(/"/g, '""')}"`,
    `"${(i.student_email || '').replace(/"/g, '""')}"`,
    `"${(i.student_phone || '').replace(/"/g, '""')}"`,
    `"${i.member_since ? i.member_since.slice(0, 10) : ''}"`,
    `"${i.confirmed_enrollments_count}"`,
    `"${i.is_repeat_student ? 'YES' : 'NO'}"`,
    `"${i.total_spend}"`,
    `"${i.last_completed_date ? i.last_completed_date.slice(0, 10) : ''}"`,
    `"${(i.current_interest || '').replace(/"/g, '""')}"`,
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
