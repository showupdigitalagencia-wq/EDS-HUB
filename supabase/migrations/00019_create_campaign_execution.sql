-- =============================================================================
-- Migration 019: campaign_recipients, campaign_test_sends, campaign_jobs
-- =============================================================================

-- 1. campaign_recipients
CREATE TABLE public.campaign_recipients (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id         UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  lead_id             UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  email               TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  variant             TEXT CHECK (variant IS NULL OR variant IN ('A', 'B')),
  provider_message_id TEXT,
  sent_at             TIMESTAMPTZ,
  error_code          TEXT,
  error_message       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_campaign_recipients_email_normalized CHECK (email = lower(trim(email))),
  CONSTRAINT uq_campaign_recipient_email UNIQUE (campaign_id, email)
);

COMMENT ON TABLE public.campaign_recipients IS 'Materialized recipients for an approved campaign. Normalized email dedup prevents double sending.';
CREATE INDEX idx_campaign_recipients_status ON public.campaign_recipients(campaign_id, status);

-- 2. campaign_test_sends
CREATE TABLE public.campaign_test_sends (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id         UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  campaign_version_id UUID REFERENCES public.campaign_versions(id) ON DELETE SET NULL,
  recipient_email     TEXT NOT NULL,
  provider_message_id TEXT,
  status              TEXT NOT NULL DEFAULT 'sent',
  error_message       TEXT,
  sent_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.campaign_test_sends IS 'Log of one-off test sends for campaign preview validation.';
CREATE INDEX idx_campaign_test_sends_campaign_id ON public.campaign_test_sends(campaign_id);

-- 3. campaign_jobs
CREATE TABLE public.campaign_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  job_type        TEXT NOT NULL DEFAULT 'send_campaign' CHECK (job_type = 'send_campaign'),
  status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  scheduled_at    TIMESTAMPTZ,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  attempt_count   INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.campaign_jobs IS 'Asynchronous and scheduled jobs for campaign batch processing.';
CREATE INDEX idx_campaign_jobs_status ON public.campaign_jobs(status);
CREATE INDEX idx_campaign_jobs_scheduled_at ON public.campaign_jobs(scheduled_at);
