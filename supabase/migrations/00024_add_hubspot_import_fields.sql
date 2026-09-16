-- =============================================================================
-- Migration 024: Add HubSpot Import Fields, Qualification Status, and Conflict Status
-- =============================================================================
-- 1. Add qualification_status, hubspot_contact_id, course_interest, course_interests to public.leads
-- 2. Add conflict_count to public.lead_imports
-- 3. Extend lead_import_rows status constraint to include 'conflict'
-- 4. Extend lead_activities activity_type constraint to include 'qualification_status_changed'
-- =============================================================================

-- 1. Add columns to public.leads
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS qualification_status TEXT NULL,
  ADD COLUMN IF NOT EXISTS hubspot_contact_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS course_interest TEXT NULL,
  ADD COLUMN IF NOT EXISTS course_interests JSONB NULL DEFAULT '[]'::jsonb;

-- Add check constraint for canonical qualification_status
ALTER TABLE public.leads
  DROP CONSTRAINT IF EXISTS leads_qualification_status_check;

ALTER TABLE public.leads
  ADD CONSTRAINT leads_qualification_status_check
  CHECK (qualification_status IS NULL OR qualification_status IN (
    'no_response',
    'some_response',
    'interested',
    'hot',
    'confirmed'
  ));

-- Unique constraint / index on hubspot_contact_id when populated
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_hubspot_contact_id
  ON public.leads(hubspot_contact_id)
  WHERE hubspot_contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_qualification_status
  ON public.leads(qualification_status);

-- 2. Add conflict_count to lead_imports
ALTER TABLE public.lead_imports
  ADD COLUMN IF NOT EXISTS conflict_count INTEGER NOT NULL DEFAULT 0;

-- 3. Update lead_import_rows status check constraint to include 'conflict'
ALTER TABLE public.lead_import_rows
  DROP CONSTRAINT IF EXISTS lead_import_rows_status_check;

ALTER TABLE public.lead_import_rows
  ADD CONSTRAINT lead_import_rows_status_check
  CHECK (status IN ('created', 'updated', 'skipped', 'failed', 'conflict'));

-- 4. Update lead_activities activity_type constraint to include 'qualification_status_changed'
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
    'csv_status_unmapped',
    'qualification_status_changed'
  ));
