-- =============================================================================
-- Migration 023: Add CSV Import Stage Change Reason and Activity Type
-- =============================================================================
-- 1. Extends lead_stage_history.change_reason check constraint to include:
--    'csv_import_stage_mapping'
-- 2. Extends lead_activities.activity_type check constraint to include:
--    'csv_status_unmapped'
-- =============================================================================

-- 1. Update lead_stage_history change_reason constraint
ALTER TABLE public.lead_stage_history
  DROP CONSTRAINT IF EXISTS lead_stage_history_change_reason_check;

ALTER TABLE public.lead_stage_history
  ADD CONSTRAINT lead_stage_history_change_reason_check
  CHECK (change_reason IN (
    'initial_assignment',
    'auto_after_intake',
    'manual',
    'csv_import_stage_mapping'
  ));

-- 2. Update lead_activities activity_type constraint
ALTER TABLE public.lead_activities
  DROP CONSTRAINT IF EXISTS lead_activities_activity_type_check;

ALTER TABLE public.lead_activities
  ADD CONSTRAINT lead_activities_activity_type_check
  CHECK (activity_type IN (
    'lead_created',
    'intake_received',
    'email_dispatched',
    'sms_dispatched',
    'call_task_created',
    'stage_changed',
    'processing_failed',
    'note_created',
    'tag_added',
    'tag_removed',
    'campaign_sent',
    'contact_preference_detected',
    'email_selected',
    'sms_selected',
    'call_selected',
    'channel_skipped',
    'csv_status_unmapped'
  ));
