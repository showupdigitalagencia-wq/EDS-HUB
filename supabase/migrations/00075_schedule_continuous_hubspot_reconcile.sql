-- =============================================================================
-- Migration 00075: Schedule Continuous HubSpot & Website Form Reconcile (pg_cron + pg_net)
-- =============================================================================
-- Triggers hubspot-reconcile Edge Function every 5 minutes to guarantee continuous
-- synchronization so no legitimate new website or HubSpot lead is silently missed.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.trigger_hubspot_reconcile()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN net.http_post(
    url := 'https://xogcexclqiornuscsdmn.supabase.co/functions/v1/hubspot-reconcile',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-admin-key', 'eds_internal_course_materials_mgmt_2026'
    ),
    body := jsonb_build_object(
      'lookback_days', 3,
      'batch_size', 50
    )
  );
END;
$$;

DO $$
BEGIN
  -- Unschedule previous job if present
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hubspot-continuous-reconcile') THEN
    PERFORM cron.unschedule('hubspot-continuous-reconcile');
  END IF;

  PERFORM cron.schedule(
    'hubspot-continuous-reconcile',
    '*/5 * * * *',
    'SELECT public.trigger_hubspot_reconcile();'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron schedule warning: %', SQLERRM;
END;
$$;
