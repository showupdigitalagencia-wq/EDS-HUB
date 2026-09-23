-- =============================================================================
-- Migration 00059: Email Delivery Lifecycle, Provider Event Logs & Suppressions
-- =============================================================================
-- Scope: Minimal, email-specific production readiness foundation.
-- 1. Extend outbound_messages status to support delivery lifecycle:
--    queued, pending, sent, delivered, failed, bounced, complained
-- 2. Add delivery timestamps (delivered_at, bounced_at, complained_at, failed_at)
-- 3. Extend campaign_recipients status to align with delivery lifecycle
-- 4. Create public.email_suppressions (hard_bounce, complaint, unsubscribe, manual)
-- 5. Create public.email_provider_event_logs for operational audit trail
-- 6. Helper RPC for unsubscribe handling
-- =============================================================================

-- 1. Extend outbound_messages status and add delivery lifecycle timestamps
ALTER TABLE public.outbound_messages
  DROP CONSTRAINT IF EXISTS outbound_messages_status_check;

ALTER TABLE public.outbound_messages
  ADD CONSTRAINT outbound_messages_status_check
  CHECK (status IN ('queued', 'pending', 'sent', 'delivered', 'failed', 'bounced', 'complained'));

ALTER TABLE public.outbound_messages
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS bounced_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS complained_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS provider_status TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_outbound_messages_provider_status
  ON public.outbound_messages(provider_status);

CREATE INDEX IF NOT EXISTS idx_outbound_messages_delivered_at
  ON public.outbound_messages(delivered_at)
  WHERE delivered_at IS NOT NULL;

-- 2. Extend campaign_recipients status and add delivery timestamps
ALTER TABLE public.campaign_recipients
  DROP CONSTRAINT IF EXISTS campaign_recipients_status_check;

ALTER TABLE public.campaign_recipients
  ADD CONSTRAINT campaign_recipients_status_check
  CHECK (status IN ('pending', 'sent', 'delivered', 'failed', 'bounced', 'complained', 'skipped'));

ALTER TABLE public.campaign_recipients
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS bounced_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS complained_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ NULL;

-- 3. Create public.email_suppressions
CREATE TABLE IF NOT EXISTS public.email_suppressions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_email    TEXT NOT NULL UNIQUE,
  reason              TEXT NOT NULL CHECK (reason IN ('hard_bounce', 'complaint', 'unsubscribe', 'manual')),
  provider            TEXT NOT NULL DEFAULT 'resend',
  provider_event_id   TEXT NULL,
  source_message_id   TEXT NULL,
  metadata            JSONB NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_email_suppressions_normalized CHECK (normalized_email = lower(trim(normalized_email)))
);

CREATE INDEX IF NOT EXISTS idx_email_suppressions_normalized_email
  ON public.email_suppressions(normalized_email);

CREATE INDEX IF NOT EXISTS idx_email_suppressions_reason
  ON public.email_suppressions(reason);

COMMENT ON TABLE public.email_suppressions IS
  'Suppressed email addresses (hard bounces, spam complaints, unsubscribes) to prevent automated outbound delivery.';

-- 4. Create public.email_provider_event_logs
CREATE TABLE IF NOT EXISTS public.email_provider_event_logs (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider                TEXT NOT NULL DEFAULT 'resend',
  provider_event_id       TEXT NOT NULL UNIQUE,
  provider_message_id     TEXT NOT NULL,
  event_type              TEXT NOT NULL,
  outbound_message_id     UUID NULL REFERENCES public.outbound_messages(id) ON DELETE SET NULL,
  campaign_recipient_id   UUID NULL REFERENCES public.campaign_recipients(id) ON DELETE SET NULL,
  recipient_email         TEXT NOT NULL,
  occurred_at             TIMESTAMPTZ NULL,
  metadata                JSONB NOT NULL DEFAULT '{}',
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_provider_events_msg_id
  ON public.email_provider_event_logs(provider_message_id);

CREATE INDEX IF NOT EXISTS idx_email_provider_events_event_id
  ON public.email_provider_event_logs(provider_event_id);

CREATE INDEX IF NOT EXISTS idx_email_provider_events_recipient
  ON public.email_provider_event_logs(lower(trim(recipient_email)));

COMMENT ON TABLE public.email_provider_event_logs IS
  'Operational event log for Resend delivery lifecycle events (sent, delivered, bounced, complained).';

-- 5. Enable RLS & Policies
ALTER TABLE public.email_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_provider_event_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_select_email_suppressions"
  ON public.email_suppressions FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_all_email_suppressions"
  ON public.email_suppressions FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_select_email_provider_events"
  ON public.email_provider_event_logs FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_all_email_provider_events"
  ON public.email_provider_event_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 6. Helper RPC for Idempotent Unsubscribe
CREATE OR REPLACE FUNCTION public.unsubscribe_recipient(
  p_email TEXT,
  p_reason TEXT DEFAULT 'unsubscribe',
  p_metadata JSONB DEFAULT '{}'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_normalized TEXT;
  v_suppression_id UUID;
BEGIN
  v_normalized := lower(trim(p_email));
  IF v_normalized IS NULL OR length(v_normalized) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid email address');
  END IF;

  INSERT INTO public.email_suppressions (
    normalized_email,
    reason,
    provider,
    metadata
  )
  VALUES (
    v_normalized,
    COALESCE(p_reason, 'unsubscribe'),
    'resend',
    COALESCE(p_metadata, '{}'::jsonb)
  )
  ON CONFLICT (normalized_email) DO UPDATE
    SET updated_at = now(),
        reason = EXCLUDED.reason
  RETURNING id INTO v_suppression_id;

  RETURN jsonb_build_object(
    'success', true,
    'suppression_id', v_suppression_id,
    'normalized_email', v_normalized,
    'reason', COALESCE(p_reason, 'unsubscribe')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.unsubscribe_recipient(TEXT, TEXT, JSONB) TO authenticated, anon;
