-- =============================================================================
-- Migration 005: leads
-- =============================================================================

CREATE TABLE public.leads (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source              TEXT NOT NULL CHECK (source IN ('meta', 'google', 'manual', 'test')),
  external_lead_id    TEXT,
  first_name          TEXT,
  last_name           TEXT,
  email               TEXT,
  email_confirmation  TEXT,
  phone_raw           TEXT,
  phone_e164          TEXT,
  contact_preference  TEXT NOT NULL CHECK (contact_preference IN ('email', 'sms', 'call')),
  pipeline_stage_id   UUID NOT NULL REFERENCES public.pipeline_stages(id) ON DELETE RESTRICT,
  source_created_at   TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.leads IS
  'Leads captured from various sources. No global email uniqueness — dedup is per source+external_lead_id.';

-- Partial unique index: prevent duplicates per source when external_lead_id is present
CREATE UNIQUE INDEX idx_leads_source_external_id
  ON public.leads(source, external_lead_id)
  WHERE external_lead_id IS NOT NULL;

-- Query indices
CREATE INDEX idx_leads_pipeline_stage ON public.leads(pipeline_stage_id);
CREATE INDEX idx_leads_created_at ON public.leads(created_at);
CREATE INDEX idx_leads_email_normalized ON public.leads(lower(email)) WHERE email IS NOT NULL;
