-- =============================================================================
-- Migration 00089: Allow 'hubspot' source in public.leads and lead_intake_events
-- =============================================================================
-- Fixes constraint violation 23514 (leads_source_check) when inserting HubSpot leads.
-- =============================================================================

ALTER TABLE public.leads 
  DROP CONSTRAINT IF EXISTS leads_source_check;

ALTER TABLE public.leads 
  ADD CONSTRAINT leads_source_check 
  CHECK (source = ANY (ARRAY['meta'::text, 'google'::text, 'manual'::text, 'test'::text, 'form'::text, 'hubspot'::text]));

ALTER TABLE public.lead_intake_events 
  DROP CONSTRAINT IF EXISTS lead_intake_events_source_check;

ALTER TABLE public.lead_intake_events 
  ADD CONSTRAINT lead_intake_events_source_check 
  CHECK (source = ANY (ARRAY['meta'::text, 'google'::text, 'manual'::text, 'test'::text, 'form'::text, 'hubspot'::text]));
