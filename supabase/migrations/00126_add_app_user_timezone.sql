-- =============================================================================
-- Migration 00126: Add Individual Timezone Column to public.app_user
-- =============================================================================
-- Adds per-user operational IANA timezone persistence (e.g. 'America/New_York',
-- 'America/Sao_Paulo', 'America/Chicago', etc.).
-- Non-destructive: column is NULL by default.
-- When NULL, EDS Hub client detects the local browser timezone as a starting
-- point and allows the authenticated user to confirm or update their individual preference.
-- Preserves all existing user accounts, credentials, and RLS policies.
-- =============================================================================

ALTER TABLE public.app_user
  ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT NULL;

COMMENT ON COLUMN public.app_user.timezone IS
  'Individual user preferred operational IANA timezone (e.g. America/New_York, America/Sao_Paulo). NULL by default until confirmed/saved by user.';
