-- =============================================================================
-- Migration 012: email_domain_status
-- =============================================================================

CREATE TABLE public.email_domain_status (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain          TEXT NOT NULL,
  resend_domain_id TEXT,
  provider_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (provider_status IN ('unknown', 'pending', 'passed', 'verified', 'failed')),
  spf_status      TEXT NOT NULL DEFAULT 'unknown'
    CHECK (spf_status IN ('unknown', 'pending', 'passed', 'verified', 'failed')),
  dkim_status     TEXT NOT NULL DEFAULT 'unknown'
    CHECK (dkim_status IN ('unknown', 'pending', 'passed', 'verified', 'failed')),
  dmarc_status    TEXT NOT NULL DEFAULT 'unknown'
    CHECK (dmarc_status IN ('unknown', 'pending', 'passed', 'verified', 'failed')),
  last_checked_at TIMESTAMPTZ,
  verified_at     TIMESTAMPTZ,
  details         JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.email_domain_status IS
  'Tracks email domain verification status (SPF, DKIM, DMARC) from Resend.';

CREATE INDEX idx_email_domain_status_domain ON public.email_domain_status(domain);
