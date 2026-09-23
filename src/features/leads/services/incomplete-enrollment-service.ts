// =============================================================================
// Incomplete Enrollment Service
// =============================================================================
// Client service for querying and managing incomplete enrollments within EDS HUB.
// Adheres strictly to security model: mutations go through authenticated RPCs.
// =============================================================================

import { supabase } from '../../../lib/supabase';
import type { IncompleteEnrollment } from '../../../types';

/**
 * Fetches the latest unresolved incomplete enrollment for a lead.
 */
export async function fetchActiveIncompleteEnrollment(
  leadId: string
): Promise<IncompleteEnrollment | null> {
  if (!leadId) return null;

  try {
    const { data, error } = await supabase
      .from('incomplete_enrollments')
      .select(`
        id,
        processing_status,
        status,
        lead_id,
        course_id,
        course_session_id,
        idempotency_key,
        external_attempt_id,
        source_page,
        utm_source,
        utm_medium,
        utm_campaign,
        task_id,
        resolved_form_submission_id,
        resolved_enrollment_id,
        resolved_at,
        created_at,
        updated_at,
        course:courses(id, name, code),
        course_session:course_sessions(id, title, start_date),
        task:tasks(id, title, status)
      `)
      .eq('lead_id', leadId)
      .eq('status', 'needs_followup')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[incomplete-enrollment-service] Error fetching active incomplete enrollment:', error);
      return null;
    }

    return (data as unknown as IncompleteEnrollment) || null;
  } catch (err) {
    console.error('[incomplete-enrollment-service] Unexpected error in fetchActiveIncompleteEnrollment:', err);
    return null;
  }
}

/**
 * Dismisses an active incomplete enrollment alert via controlled RPC.
 * Automatically cancels its linked pending task.
 */
export async function dismissIncompleteEnrollment(
  incompleteEnrollmentId: string,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  if (!incompleteEnrollmentId) {
    return { success: false, error: 'Missing incomplete enrollment ID' };
  }

  try {
    const { data, error } = await supabase.rpc('dismiss_incomplete_enrollment', {
      p_incomplete_enrollment_id: incompleteEnrollmentId,
      p_reason: reason || null,
    });

    if (error) {
      console.error('[incomplete-enrollment-service] Error dismissing incomplete enrollment:', error);
      return { success: false, error: error.message };
    }

    return { success: !!data };
  } catch (err) {
    console.error('[incomplete-enrollment-service] Unexpected error in dismissIncompleteEnrollment:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error during dismissal',
    };
  }
}
