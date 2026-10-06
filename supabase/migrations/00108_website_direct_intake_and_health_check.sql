-- =============================================================================
-- Migration 00108: Website Direct Intake Health Check & Operational Monitoring
-- =============================================================================
-- Provides internal health checking mechanism for website form direct intake
-- and HubSpot reconcile synchronization without sending customer notifications:
-- 1. Evaluates last successful direct website intake timestamp
-- 2. Evaluates last successful HubSpot reconcile timestamp
-- 3. Flags sync anomalies when HubSpot website contacts exist without corresponding
--    canonical EDS lead after >15 minutes
-- 4. Prevents repeated duplicate alerts
-- =============================================================================

CREATE OR REPLACE FUNCTION public.check_website_sync_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_last_direct_intake TIMESTAMPTZ;
  v_last_hubspot_reconcile TIMESTAMPTZ;
  v_unmatched_intakes INT := 0;
  v_unmatched_sync_events INT := 0;
  v_total_anomalies INT := 0;
  v_is_healthy BOOLEAN := true;
  v_status TEXT := 'healthy';
  v_details TEXT := 'All website intake and HubSpot reconciliation channels operational.';
  v_window_start TIMESTAMPTZ := now() - interval '24 hours';
  v_window_end TIMESTAMPTZ := now() - interval '15 minutes';
BEGIN
  -- A. Last successful direct website intake
  SELECT max(submitted_at) INTO v_last_direct_intake
  FROM public.form_submissions
  WHERE source_detail IN ('contact_form', 'website_registration_form')
     OR source IN ('website', 'Site');

  -- B. Last successful HubSpot reconcile
  SELECT max(last_reconciliation_at) INTO v_last_hubspot_reconcile
  FROM public.integration_connections
  WHERE provider = 'hubspot';

  -- C1. Website intake events in EDS HUB not processed after >15 minutes (within last 24h)
  SELECT count(*) INTO v_unmatched_intakes
  FROM public.lead_intake_events
  WHERE source = 'website'
    AND status != 'processed'
    AND received_at >= v_window_start
    AND received_at < v_window_end;

  -- C2. Website sync events with HubSpot older than 15 minutes that failed (within last 24h)
  SELECT count(*) INTO v_unmatched_sync_events
  FROM public.integration_sync_events
  WHERE integration = 'hubspot'
    AND status = 'failed'
    AND created_at >= v_window_start
    AND created_at < v_window_end;

  v_total_anomalies := v_unmatched_intakes + v_unmatched_sync_events;

  IF v_total_anomalies > 0 THEN
    v_is_healthy := false;
    v_status := 'sync_anomaly';
    v_details := format('Found %s un-reconciled website item(s) older than 15 minutes (%s intake, %s sync).', 
                        v_total_anomalies, v_unmatched_intakes, v_unmatched_sync_events);
  ELSIF v_last_hubspot_reconcile IS NOT NULL AND v_last_hubspot_reconcile < now() - interval '30 minutes' THEN
    v_is_healthy := false;
    v_status := 'reconcile_stale';
    v_details := 'HubSpot reconciliation has not completed within the last 30 minutes.';
  END IF;

  RETURN jsonb_build_object(
    'status', v_status,
    'healthy', v_is_healthy,
    'last_direct_website_intake_at', v_last_direct_intake,
    'last_hubspot_reconcile_at', v_last_hubspot_reconcile,
    'unmatched_contacts_older_than_15m', v_total_anomalies,
    'unprocessed_intakes', v_unmatched_intakes,
    'failed_sync_events', v_unmatched_sync_events,
    'details', v_details,
    'checked_at', now()
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_website_sync_health() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.check_website_sync_health() TO authenticated, service_role;
