-- =============================================================================
-- Migration 00107: Secure HubSpot Reconcile & Activity Sync Vault Authentication
-- =============================================================================
-- 1. Updates public.trigger_hubspot_reconcile() to retrieve the current admin secret
--    dynamically from vault.decrypted_secrets instead of hardcoding any stale secret.
-- 2. Updates public.trigger_hubspot_activity_sync() to dynamically retrieve from vault.
-- 3. Removes stale hardcoded secret dependencies.
-- 4. Cleans up temporary secret sync helper.
-- =============================================================================

DROP FUNCTION IF EXISTS public.sync_vault_admin_secret(text);

CREATE OR REPLACE FUNCTION public.trigger_hubspot_reconcile()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
DECLARE
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'INTERNAL_ADMIN_SECRET'
  LIMIT 1;

  RETURN net.http_post(
    url := 'https://xogcexclqiornuscsdmn.supabase.co/functions/v1/hubspot-reconcile',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-admin-key', coalesce(v_secret, ''),
      'Authorization', 'Bearer ' || coalesce(v_secret, '')
    ),
    body := jsonb_build_object(
      'lookback_days', 3,
      'batch_size', 50
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.trigger_hubspot_reconcile() TO postgres, service_role, authenticated;

CREATE OR REPLACE FUNCTION public.trigger_hubspot_activity_sync(p_action text default 'incremental')
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
DECLARE
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'INTERNAL_ADMIN_SECRET'
  LIMIT 1;

  RETURN net.http_post(
    url := 'https://xogcexclqiornuscsdmn.supabase.co/functions/v1/hubspot-activity-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-admin-key', coalesce(v_secret, ''),
      'Authorization', 'Bearer ' || coalesce(v_secret, '')
    ),
    body := jsonb_build_object(
      'action', p_action,
      'incremental', (p_action = 'incremental'),
      'max_pages', 10,
      'limit', 100
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.trigger_hubspot_activity_sync(text) TO postgres, service_role, authenticated;
