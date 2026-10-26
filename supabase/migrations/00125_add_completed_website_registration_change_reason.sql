-- =============================================================================
-- Migration 00125: Add completed_website_registration to lead_stage_history constraint
-- =============================================================================
-- Adds 'completed_website_registration' to lead_stage_history_change_reason_check
-- constraint so that new completed website registrations can record their stage
-- assignment history atomically without constraint errors.
-- =============================================================================

ALTER TABLE public.lead_stage_history
  DROP CONSTRAINT IF EXISTS lead_stage_history_change_reason_check;

ALTER TABLE public.lead_stage_history
  ADD CONSTRAINT lead_stage_history_change_reason_check
  CHECK (change_reason IN (
    'initial_assignment',
    'initial_form_submission',
    'completed_website_registration',
    'auto_after_intake',
    'manual',
    'csv_import_stage_mapping',
    'enrollment_confirmed',
    'course_completed',
    'post_course_transition',
    'alumni_transition',
    'baseline_reset'
  ));

ALTER TABLE public.internal_notification_logs
  DROP CONSTRAINT IF EXISTS internal_notification_logs_event_type_check;

ALTER TABLE public.internal_notification_logs
  ADD CONSTRAINT internal_notification_logs_event_type_check
  CHECK (event_type IN (
    'incomplete_registration',
    'completed_registration',
    'contact_us',
    'course_information_request'
  ));

