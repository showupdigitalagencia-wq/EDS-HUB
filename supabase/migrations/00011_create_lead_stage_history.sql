-- =============================================================================
-- Migration 011: lead_stage_history
-- =============================================================================

CREATE TABLE public.lead_stage_history (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id             UUID NOT NULL REFERENCES public.leads(id) ON DELETE RESTRICT,
  from_stage_id       UUID REFERENCES public.pipeline_stages(id) ON DELETE SET NULL,
  to_stage_id         UUID NOT NULL REFERENCES public.pipeline_stages(id) ON DELETE RESTRICT,
  change_reason       TEXT NOT NULL CHECK (change_reason IN ('initial_assignment', 'auto_after_intake')),
  changed_by_user_id  UUID REFERENCES public.app_user(user_id) ON DELETE SET NULL,
  intake_event_id     UUID REFERENCES public.lead_intake_events(id) ON DELETE SET NULL,
  changed_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.lead_stage_history IS
  'Immutable record of every pipeline stage change for a lead.';

CREATE INDEX idx_stage_history_lead_changed ON public.lead_stage_history(lead_id, changed_at);
