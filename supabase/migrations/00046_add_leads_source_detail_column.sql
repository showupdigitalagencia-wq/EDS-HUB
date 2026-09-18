-- =============================================================================
-- Migration 00046: Add source_detail to public.leads
-- =============================================================================
-- Migration 00028 trigger `handle_lead_created_automation_trigger` references
-- `NEW.source_detail`. This migration ensures public.leads has `source_detail`
-- so that lead creation triggers succeed cleanly.
-- =============================================================================

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS source_detail TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_source_detail 
  ON public.leads(source_detail) 
  WHERE source_detail IS NOT NULL;
