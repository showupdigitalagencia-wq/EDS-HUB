-- =============================================================================
-- Migration 00117: Fix Lead Stage History Change Reason Constraint
-- =============================================================================
-- Adds 'initial_form_submission' to lead_stage_history_change_reason_check
-- constraint so that initial public form submissions can record their stage
-- assignment history atomically without constraint errors.
-- =============================================================================

ALTER TABLE public.lead_stage_history
  DROP CONSTRAINT IF EXISTS lead_stage_history_change_reason_check;

ALTER TABLE public.lead_stage_history
  ADD CONSTRAINT lead_stage_history_change_reason_check
  CHECK (change_reason IN (
    'initial_assignment',
    'initial_form_submission',
    'auto_after_intake',
    'manual',
    'csv_import_stage_mapping',
    'enrollment_confirmed',
    'course_completed',
    'post_course_transition',
    'alumni_transition',
    'baseline_reset'
  ));
