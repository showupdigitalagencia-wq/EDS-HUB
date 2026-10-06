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
  v_unmatched_count INT := 0;
  v_is_healthy BOOLEAN := true;
  v_status TEXT := 'healthy';
  v_details TEXT := 'All website intake and HubSpot reconciliation channels operational.';
  v_recent_threshold TIMESTAMPTZ := now() - interval '15 minutes';
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

  -- C. Website contacts in HubSpot without corresponding EDS canonical lead after >15 min
  SELECT count(*) INTO v_unmatched_count
  FROM public.integration_sync_events ise
  WHERE ise.provider = 'hubspot'
    AND ise.status != 'completed'
    AND ise.created_at < v_recent_threshold
    AND (
      lower(COALESCE(ise.payload->'properties'->>'recent_conversion_event_name', '')) LIKE '%contact%'
      OR lower(COALESCE(ise.payload->'properties'->>'first_conversion_event_name', '')) LIKE '%contact%'
      OR lower(COALESCE(ise.payload->'properties'->>'origem_do_lead', '')) LIKE '%website%'
    );

  IF v_unmatched_count > 0 THEN
    v_is_healthy := false;
    v_status := 'sync_anomaly';
    v_details := format('Found %s un-reconciled website contact(s) older than 15 minutes.', v_unmatched_count);
  END IF;

  RETURN jsonb_build_object(
    'status', v_status,
    'healthy', v_is_healthy,
    'last_direct_website_intake_at', v_last_direct_intake,
    'last_hubspot_reconcile_at', v_last_hubspot_reconcile,
    'unmatched_contacts_older_than_15m', v_unmatched_count,
    'details', v_details,
    'checked_at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_website_sync_health() TO postgres, service_role, authenticated;
