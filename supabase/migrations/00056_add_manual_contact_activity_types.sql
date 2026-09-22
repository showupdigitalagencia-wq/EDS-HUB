-- =============================================================================
-- Migration 00056: Add Manual Contact Activity Types for Client Quick Actions
-- =============================================================================
-- Extends public.lead_activities.activity_type check constraint to support
-- manual contact intents: 'call_manual_attempt', 'whatsapp_contact_attempt',
-- 'email_manual_attempt', and 'sms_manual_attempt'.
-- All 49 existing activity types are strictly preserved.
-- =============================================================================

ALTER TABLE public.lead_activities
  DROP CONSTRAINT IF EXISTS lead_activities_activity_type_check;

ALTER TABLE public.lead_activities
  ADD CONSTRAINT lead_activities_activity_type_check
  CHECK (activity_type = ANY (ARRAY[
    'lead_created'::text, 'intake_received'::text, 'email_dispatched'::text, 
    'sms_dispatched'::text, 'call_task_created'::text, 'stage_changed'::text, 
    'processing_failed'::text, 'note_created'::text, 'tag_added'::text, 
    'tag_removed'::text, 'campaign_sent'::text, 'contact_preference_detected'::text, 
    'email_selected'::text, 'sms_selected'::text, 'call_selected'::text, 
    'channel_skipped'::text, 'csv_status_unmapped'::text, 'qualification_status_changed'::text,
    'form_submitted'::text, 'automation_started'::text, 'automation_completed'::text,
    'automation_failed'::text, 'sequence_started'::text, 'sequence_completed'::text, 
    'sequence_failed'::text, 'sequence_stopped'::text, 'email_reply_received'::text, 
    'sms_reply_received'::text, 'enrollment_created'::text, 'enrollment_confirmed'::text,
    'course_session_assigned'::text, 'course_session_changed'::text, 'attendance_recorded'::text, 
    'course_completed'::text, 'student_no_show'::text, 'checklist_item_updated'::text,
    'post_course_followup_created'::text, 'post_course_followup_completed'::text,
    'feedback_requested'::text, 'feedback_received'::text, 'testimonial_requested'::text,
    'testimonial_received'::text, 'future_course_interest_added'::text, 'task_created'::text,
    'task_rescheduled'::text, 'task_completed'::text,
    'hubspot_contact_linked'::text,
    'hubspot_field_updated'::text,
    'hubspot_outbound_synced'::text,
    'hubspot_sync_conflict'::text,
    -- Batch 4 manual quick action activity types
    'call_manual_attempt'::text,
    'whatsapp_contact_attempt'::text,
    'email_manual_attempt'::text,
    'sms_manual_attempt'::text
  ]));

COMMENT ON CONSTRAINT lead_activities_activity_type_check ON public.lead_activities IS
  'Allowed activity types including manual call, WhatsApp, SMS, and email contact attempts.';
