-- =============================================================================
-- Migration 022: Add Contact Preference Activity Types
-- =============================================================================
-- Extends lead_activities.activity_type check constraint to include canonical
-- contact preference decision and channel skip audit events:
-- - contact_preference_detected
-- - email_selected
-- - sms_selected
-- - call_selected
-- - channel_skipped
-- Also ensures channel check constraint permits 'call' in addition to email and sms.
-- =============================================================================

ALTER TABLE public.lead_activities
  DROP CONSTRAINT IF EXISTS lead_activities_activity_type_check;

ALTER TABLE public.lead_activities
  ADD CONSTRAINT lead_activities_activity_type_check
  CHECK (activity_type IN (
    'lead_created', 'intake_received', 'email_dispatched',
    'sms_dispatched', 'call_task_created', 'stage_changed',
    'processing_failed', 'note_created', 'tag_added', 'tag_removed', 'campaign_sent',
    'contact_preference_detected', 'email_selected', 'sms_selected', 'call_selected', 'channel_skipped'
  ));

ALTER TABLE public.lead_activities
  DROP CONSTRAINT IF EXISTS lead_activities_channel_check;

ALTER TABLE public.lead_activities
  ADD CONSTRAINT lead_activities_channel_check
  CHECK (channel IS NULL OR channel IN ('email', 'sms', 'call'));
