-- =============================================================================
-- Migration 002: Auth Helper Function
-- =============================================================================
-- Creates a SECURITY DEFINER function to check if the current auth user
-- is an active member of app_user. Used by all RLS policies.
-- Depends on: public.app_user (created in Migration 001)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_active_app_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_user
    WHERE user_id = auth.uid()
      AND is_active = true
  );
$$;

COMMENT ON FUNCTION public.is_active_app_user() IS
  'Returns true if the current auth user is an active app_user. Used by RLS policies.';
