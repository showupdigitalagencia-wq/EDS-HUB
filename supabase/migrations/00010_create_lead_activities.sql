-- =============================================================================
-- Migration 010: lead_activities
-- =============================================================================
-- Append-only audit trail for lead events. No UPDATE or DELETE allowed.
-- =============================================================================

CREATE TABLE public.lead_activities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         UUID NOT NULL REFERENCES public.leads(id) ON DELETE RESTRICT,
  intake_event_id UUID REFERENCES public.lead_intake_events(id) ON DELETE SET NULL,
  activity_type   TEXT NOT NULL CHECK (activity_type IN (
    'lead_created', 'intake_received', 'email_dispatched',
    'sms_dispatched', 'call_task_created', 'stage_changed',
    'processing_failed'
  )),
  channel         TEXT CHECK (channel IS NULL OR channel IN ('email', 'sms')),
  actor_type      TEXT NOT NULL CHECK (actor_type IN ('system', 'user')),
  summary         TEXT NOT NULL,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.lead_activities IS
  'Append-only activity log for leads. Will serve as the basis for the CRM timeline in future phases.';

CREATE INDEX idx_lead_activities_lead_created ON public.lead_activities(lead_id, created_at);
