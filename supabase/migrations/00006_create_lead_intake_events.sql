-- =============================================================================
-- Migration 006: lead_intake_events
-- =============================================================================

CREATE TABLE public.lead_intake_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source              TEXT NOT NULL CHECK (source IN ('meta', 'google', 'manual', 'test')),
  external_event_id   TEXT,
  external_lead_id    TEXT,
  idempotency_key     TEXT NOT NULL UNIQUE,
  raw_payload         JSONB NOT NULL DEFAULT '{}',
  normalized_payload  JSONB NOT NULL DEFAULT '{}',
  status              TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'processing', 'processed', 'failed', 'duplicate')),
  lead_id             UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  last_error          TEXT,
  received_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at        TIMESTAMPTZ
);

COMMENT ON TABLE public.lead_intake_events IS
  'Records each lead intake event before any external effects. Idempotency key prevents duplicate processing.';

CREATE INDEX idx_intake_events_received_at ON public.lead_intake_events(received_at);
CREATE INDEX idx_intake_events_status ON public.lead_intake_events(status);
CREATE INDEX idx_intake_events_lead_id ON public.lead_intake_events(lead_id);
