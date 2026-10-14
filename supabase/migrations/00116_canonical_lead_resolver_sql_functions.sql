-- =============================================================================
-- Migration 00116: Canonical Lead Resolver SQL Functions
-- =============================================================================
-- Provides public.find_canonical_lead_by_email(TEXT) and
-- public.find_canonical_lead_by_phone(TEXT) to reliably find canonical leads
-- with active-lead priority and created_at preservation.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.find_canonical_lead_by_email(p_email TEXT)
RETURNS UUID
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_clean TEXT := lower(trim(COALESCE(p_email, '')));
  v_lead_id UUID := NULL;
BEGIN
  IF v_clean = '' THEN
    RETURN NULL;
  END IF;

  -- 1. Try public.leads primary email (prioritizing non-deleted leads, then oldest created_at)
  SELECT id INTO v_lead_id
  FROM public.leads
  WHERE lower(email) = v_clean
  ORDER BY (CASE WHEN deleted_at IS NULL THEN 0 ELSE 1 END), created_at ASC
  LIMIT 1;

  IF v_lead_id IS NOT NULL THEN
    RETURN v_lead_id;
  END IF;

  -- 2. Try public.lead_emails normalized_email
  SELECT lead_id INTO v_lead_id
  FROM public.lead_emails
  WHERE normalized_email = v_clean
  ORDER BY (CASE WHEN is_primary THEN 0 ELSE 1 END), created_at ASC
  LIMIT 1;

  RETURN v_lead_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.find_canonical_lead_by_phone(p_phone TEXT)
RETURNS UUID
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_clean TEXT := trim(COALESCE(p_phone, ''));
  v_lead_id UUID := NULL;
BEGIN
  IF v_clean = '' THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_lead_id
  FROM public.leads
  WHERE phone_e164 = v_clean OR phone_raw = v_clean
  ORDER BY (CASE WHEN deleted_at IS NULL THEN 0 ELSE 1 END), created_at ASC
  LIMIT 1;

  RETURN v_lead_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.find_canonical_lead_by_email(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.find_canonical_lead_by_email(TEXT) TO authenticated, service_role, anon;

REVOKE EXECUTE ON FUNCTION public.find_canonical_lead_by_phone(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.find_canonical_lead_by_phone(TEXT) TO authenticated, service_role, anon;
