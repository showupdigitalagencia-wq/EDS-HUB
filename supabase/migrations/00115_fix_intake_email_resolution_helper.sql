-- =============================================================================
-- Migration 00115: Fix Intake Email Resolution Helper Function
-- =============================================================================
-- Provides public.resolve_intake_emails(TEXT, TEXT) for SQL-level email
-- normalization, mismatch detection, and deduplication across public form submissions
-- and HubSpot inbound batch processing.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.resolve_intake_emails(
  p_email TEXT,
  p_email_conf TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_clean_email TEXT := lower(trim(COALESCE(p_email, '')));
  v_clean_conf TEXT := lower(trim(COALESCE(p_email_conf, '')));
  v_mismatch BOOLEAN := false;
BEGIN
  IF v_clean_email = '' THEN
    v_clean_email := NULL;
  END IF;

  IF v_clean_conf = '' THEN
    v_clean_conf := v_clean_email;
  END IF;

  IF v_clean_email IS NOT NULL AND v_clean_conf IS NOT NULL AND v_clean_email <> v_clean_conf THEN
    v_mismatch := true;
  END IF;

  RETURN jsonb_build_object(
    'primary_email', v_clean_email,
    'confirmation_email', v_clean_conf,
    'is_mismatch', v_mismatch,
    'divergence', v_mismatch
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_intake_emails(TEXT, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.resolve_intake_emails(TEXT, TEXT) TO authenticated, service_role, anon;
