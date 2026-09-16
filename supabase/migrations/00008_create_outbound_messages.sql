-- =============================================================================
-- Migration 008: outbound_messages
-- =============================================================================

CREATE TABLE public.outbound_messages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id             UUID NOT NULL REFERENCES public.leads(id) ON DELETE RESTRICT,
  intake_event_id     UUID NOT NULL REFERENCES public.lead_intake_events(id) ON DELETE RESTRICT,
  channel             TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
  provider            TEXT NOT NULL CHECK (provider IN ('resend', 'twilio')),
  recipient           TEXT NOT NULL,
  template_key        TEXT NOT NULL,
  subject_snapshot    TEXT,
  body_snapshot       TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed')),
  provider_message_id TEXT,
  idempotency_key     TEXT NOT NULL UNIQUE,
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  error_code          TEXT,
  error_message       TEXT,
  sent_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.outbound_messages IS
  'One row per actual outbound message (one per recipient). Snapshots preserve the exact content sent for audit.';

CREATE INDEX idx_outbound_messages_lead_id ON public.outbound_messages(lead_id);
CREATE INDEX idx_outbound_messages_intake_event ON public.outbound_messages(intake_event_id);
CREATE INDEX idx_outbound_messages_status ON public.outbound_messages(status);
