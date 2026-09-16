-- =============================================================================
-- Migration 018: campaigns, campaign_versions, campaign_audiences, campaign_variants
-- =============================================================================

-- 1. campaigns
CREATE TABLE public.campaigns (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  description         TEXT,
  channel             TEXT NOT NULL DEFAULT 'email' CHECK (channel = 'email'),
  status              TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_approval', 'approved', 'scheduled', 'sending', 'sent', 'cancelled', 'failed')),
  subject             TEXT NOT NULL DEFAULT '',
  preview_text        TEXT,
  from_name           TEXT NOT NULL DEFAULT '',
  reply_to            TEXT,
  template_id         UUID REFERENCES public.email_templates(id) ON DELETE SET NULL,
  scheduled_at        TIMESTAMPTZ,
  approved_at         TIMESTAMPTZ,
  approved_by_user_id UUID REFERENCES public.app_user(user_id) ON DELETE SET NULL,
  created_by_user_id  UUID REFERENCES public.app_user(user_id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.campaigns IS 'Email marketing campaigns with mandatory approval before sending.';
CREATE INDEX idx_campaigns_status ON public.campaigns(status);
CREATE INDEX idx_campaigns_created_at ON public.campaigns(created_at DESC);

-- 2. campaign_versions (version history — never silently overwrite)
CREATE TABLE public.campaign_versions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id         UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  version_number      INTEGER NOT NULL,
  subject             TEXT NOT NULL,
  preview_text        TEXT,
  content_json        JSONB NOT NULL DEFAULT '[]',
  html_snapshot       TEXT NOT NULL DEFAULT '',
  text_snapshot       TEXT NOT NULL DEFAULT '',
  created_by_user_id  UUID REFERENCES public.app_user(user_id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_campaign_version UNIQUE (campaign_id, version_number)
);

COMMENT ON TABLE public.campaign_versions IS 'Immutable snapshots of campaign content versions.';
CREATE INDEX idx_campaign_versions_campaign_id ON public.campaign_versions(campaign_id);

-- 3. campaign_audiences (audience definition without pre-materialization)
CREATE TABLE public.campaign_audiences (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id                 UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  filter_definition           JSONB NOT NULL DEFAULT '{}',
  estimated_recipient_count   INTEGER NOT NULL DEFAULT 0,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_campaign_audience UNIQUE (campaign_id)
);

COMMENT ON TABLE public.campaign_audiences IS 'Filter configuration for selecting campaign target recipients.';

-- 4. campaign_variants (A/B testing support)
CREATE TABLE public.campaign_variants (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id         UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  variant_key         TEXT NOT NULL CHECK (variant_key IN ('A', 'B')),
  subject             TEXT NOT NULL,
  content_json        JSONB NOT NULL DEFAULT '[]',
  html_snapshot       TEXT NOT NULL DEFAULT '',
  traffic_percentage  NUMERIC NOT NULL DEFAULT 50 CHECK (traffic_percentage >= 0 AND traffic_percentage <= 100),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_campaign_variant UNIQUE (campaign_id, variant_key)
);

COMMENT ON TABLE public.campaign_variants IS 'A/B test variants for subject or content variations.';
