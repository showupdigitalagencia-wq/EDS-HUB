-- =============================================================================
-- Migration 00099: Schedule Dedicated HubSpot Activity Sync Cron (pg_cron + pg_net)
-- =============================================================================
-- Triggers hubspot-activity-sync Edge Function in incremental mode every 15 minutes.
-- Operates completely independently from contact reconciliation (no coupling).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.trigger_hubspot_activity_sync(p_action text default 'incremental')
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN net.http_post(
    url := 'https://xogcexclqiornuscsdmn.supabase.co/functions/v1/hubspot-activity-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-admin-key', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'INTERNAL_ADMIN_SECRET' limit 1), 'eds_internal_course_materials_mgmt_2026')
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

DO $$
BEGIN
  -- Unschedule previous job if present
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hubspot-activity-sync') THEN
    PERFORM cron.unschedule('hubspot-activity-sync');
  END IF;

  PERFORM cron.schedule(
    'hubspot-activity-sync',
    '*/15 * * * *',
    'SELECT public.trigger_hubspot_activity_sync(''incremental'');'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron schedule warning: %', SQLERRM;
END;
$$;
