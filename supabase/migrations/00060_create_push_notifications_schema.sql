-- =============================================================================
-- Migration 00060: PWA Web Push Subscriptions, Preferences & Idempotent Delivery
-- =============================================================================
-- Enables multi-device Web Push notifications for administrative users:
-- 1. push_subscriptions: Stores encrypted browser endpoints per authenticated user.
-- 2. push_notification_preferences: Granular category toggles per admin user.
-- 3. push_notification_logs: Immutable delivery audit with per-device idempotency.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Push Subscriptions Table (Multi-Device per User)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint        TEXT NOT NULL UNIQUE,
  p256dh          TEXT NOT NULL,
  auth_key        TEXT NOT NULL,
  user_agent      TEXT,
  device_type     TEXT DEFAULT 'unknown' CHECK (device_type IN ('mobile', 'tablet', 'desktop', 'unknown')),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.push_subscriptions IS
  'Active browser and device Web Push subscriptions per authenticated administrator.';

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON public.push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_status ON public.push_subscriptions(status);

-- -----------------------------------------------------------------------------
-- 2. Push Notification Preferences Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.push_notification_preferences (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  new_leads                 BOOLEAN NOT NULL DEFAULT true,
  sms_preference            BOOLEAN NOT NULL DEFAULT true,
  inbound_emails            BOOLEAN NOT NULL DEFAULT true,
  incomplete_registrations  BOOLEAN NOT NULL DEFAULT true,
  tasks                     BOOLEAN NOT NULL DEFAULT true,
  deliverability_critical   BOOLEAN NOT NULL DEFAULT true,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.push_notification_preferences IS
  'Per-admin category preferences governing push notification dispatch.';

-- -----------------------------------------------------------------------------
-- 3. Push Notification Delivery Logs & Idempotency
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.push_notification_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  subscription_id   UUID REFERENCES public.push_subscriptions(id) ON DELETE SET NULL,
  event_type        TEXT NOT NULL,
  event_id          TEXT,
  title             TEXT NOT NULL,
  body              TEXT NOT NULL,
  deep_link         TEXT,
  status            TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'suppressed_preference', 'suppressed_idempotent')),
  idempotency_key   TEXT,
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.push_notification_logs IS
  'Immutable log of sent and suppressed push notifications with per-device idempotency.';

CREATE INDEX IF NOT EXISTS idx_push_logs_user ON public.push_notification_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_push_logs_created ON public.push_notification_logs(created_at DESC);

-- Unique index to prevent duplicate push dispatch to the same device subscription for the same event
CREATE UNIQUE INDEX IF NOT EXISTS idx_push_logs_device_idempotency
  ON public.push_notification_logs(subscription_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND subscription_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 4. Row Level Security (RLS)
-- -----------------------------------------------------------------------------
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_notification_logs ENABLE ROW LEVEL SECURITY;

-- push_subscriptions policies
DROP POLICY IF EXISTS "push_subscriptions_select_own" ON public.push_subscriptions;
CREATE POLICY "push_subscriptions_select_own" ON public.push_subscriptions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "push_subscriptions_insert_own" ON public.push_subscriptions;
CREATE POLICY "push_subscriptions_insert_own" ON public.push_subscriptions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "push_subscriptions_update_own" ON public.push_subscriptions;
CREATE POLICY "push_subscriptions_update_own" ON public.push_subscriptions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "push_subscriptions_delete_own" ON public.push_subscriptions;
CREATE POLICY "push_subscriptions_delete_own" ON public.push_subscriptions
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- push_notification_preferences policies
DROP POLICY IF EXISTS "push_preferences_select_own" ON public.push_notification_preferences;
CREATE POLICY "push_preferences_select_own" ON public.push_notification_preferences
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "push_preferences_insert_own" ON public.push_notification_preferences;
CREATE POLICY "push_preferences_insert_own" ON public.push_notification_preferences
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "push_preferences_update_own" ON public.push_notification_preferences;
CREATE POLICY "push_preferences_update_own" ON public.push_notification_preferences
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- push_notification_logs policies
DROP POLICY IF EXISTS "push_logs_select_own" ON public.push_notification_logs;
CREATE POLICY "push_logs_select_own" ON public.push_notification_logs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
