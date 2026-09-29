-- Migration 00083: Add lead_field_updated to lead_activities_activity_type_check
-- =============================================================================

ALTER TABLE public.lead_activities
  DROP CONSTRAINT IF EXISTS lead_activities_activity_type_check;

ALTER TABLE public.lead_activities
  ADD CONSTRAINT lead_activities_activity_type_check
  CHECK (activity_type = ANY (ARRAY[
    'lead_created'::text, 'lead_field_updated'::text, 'intake_received'::text, 'email_dispatched'::text, 
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
    'call_manual_attempt'::text,
    'whatsapp_contact_attempt'::text,
    'email_manual_attempt'::text,
    'sms_manual_attempt'::text,
    'sms_manual_confirmed'::text,
    'whatsapp_contact_confirmed'::text,
    'incomplete_enrollment_captured'::text,
    'incomplete_enrollment_recovered'::text,
    'incomplete_enrollment_dismissed'::text,
    'email_sent'::text,
    'email_delivered'::text,
    'email_opened'::text,
    'email_clicked'::text,
    'email_delivery_delayed'::text,
    'email_bounced'::text,
    'email_complained'::text,
    'email_failed'::text,
    'email_suppressed'::text,
    'email_unsubscribed'::text
  ]));
