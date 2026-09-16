-- =============================================================================
-- Migration 021: Align campaign_recipients constraints
-- =============================================================================
-- Ensures email normalization CHECK constraint exists.
-- Ensures UNIQUE(campaign_id, email) constraint exists.
-- Removes redundant UNIQUE(campaign_id, lead_id) constraint.
-- =============================================================================

ALTER TABLE public.campaign_recipients
  DROP CONSTRAINT IF EXISTS uq_campaign_recipient_lead;

ALTER TABLE public.campaign_recipients
  DROP CONSTRAINT IF EXISTS ck_campaign_recipients_email_normalized;

ALTER TABLE public.campaign_recipients
  ADD CONSTRAINT ck_campaign_recipients_email_normalized
  CHECK (email = lower(trim(email)));

ALTER TABLE public.campaign_recipients
  DROP CONSTRAINT IF EXISTS uq_campaign_recipient_email;

ALTER TABLE public.campaign_recipients
  ADD CONSTRAINT uq_campaign_recipient_email
  UNIQUE (campaign_id, email);
