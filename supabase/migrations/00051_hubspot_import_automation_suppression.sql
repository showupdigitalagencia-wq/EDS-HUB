-- =============================================================================
-- Migration 00051: HubSpot Import & Historical Sync Automation Suppression
-- =============================================================================
-- Defense-in-depth safety guard:
-- Prevents automated initial outreach and sequence dispatch from triggering
-- when contacts are inserted or updated via:
-- 1. HubSpot continuous sync / initial sync / reconciliation (app.sync_origin = 'hubspot_sync')
-- 2. Explicit historical import markers (source_detail IN ('hubspot_sync', 'hubspot_historical', 'csv_import'))
-- 3. Synthetic test leads (source = 'test')
--
-- Preserves normal automated event generation for real-time manual leads,
-- Meta/Instagram advertising leads, and website forms.
-- =============================================================================

-- 1. Redefine trg_capture_lead_created_event with suppression defense
CREATE OR REPLACE FUNCTION public.trg_capture_lead_created_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sync_origin TEXT;
  v_suppress_hubspot BOOLEAN := true;
BEGIN
  -- 1. Check transaction-local sync origin (established in Migration 00049)
  v_sync_origin := current_setting('app.sync_origin', true);
  IF v_sync_origin IN ('hubspot_sync', 'hubspot_historical', 'hubspot_reconcile') THEN
    RETURN NEW; -- Suppress event during HubSpot sync/reconciliation
  END IF;

  -- 2. Check source_detail markers
  IF NEW.source_detail IN ('hubspot_sync', 'hubspot_historical', 'csv_import') THEN
    -- Check if HubSpot connection explicitly allows integration triggers (defaults to true / suppress)
    IF NEW.source_detail IN ('hubspot_sync', 'hubspot_historical') THEN
      SELECT COALESCE(auto_suppress_automations, true) INTO v_suppress_hubspot
      FROM public.integration_connections
      WHERE provider = 'hubspot'
      LIMIT 1;

      IF v_suppress_hubspot IS TRUE THEN
        RETURN NEW; -- Suppress historical / unverified HubSpot contacts
      END IF;
    ELSE
      -- CSV imports are historical and never trigger initial automatic outreach
      RETURN NEW;
    END IF;
  END IF;

  -- 3. Suppress test leads from initial live outreach
  IF NEW.source = 'test' THEN
    RETURN NEW;
  END IF;

  -- 4. Emit lead_created automation event for eligible leads (manual, Meta, form, future real-time)
  INSERT INTO public.automation_events (
    event_type,
    lead_id,
    source_table,
    source_record_id,
    source_event_key,
    payload
  ) VALUES (
    'lead_created',
    NEW.id,
    'leads',
    NEW.id::text,
    'lead_created:' || NEW.id::text,
    jsonb_build_object(
      'source', NEW.source,
      'source_detail', NEW.source_detail,
      'course_interest', NEW.course_interest,
      'contact_preference', NEW.contact_preference,
      'pipeline_stage_id', NEW.pipeline_stage_id,
      'qualification_status', NEW.qualification_status
    )
  )
  ON CONFLICT (source_event_key) DO NOTHING;

  RETURN NEW;
END;
$$;

-- 2. Redefine trg_capture_qualification_status_changed_event with suppression defense
CREATE OR REPLACE FUNCTION public.trg_capture_qualification_status_changed_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sync_origin TEXT;
BEGIN
  -- Suppress event during HubSpot batch sync or reconciliation
  v_sync_origin := current_setting('app.sync_origin', true);
  IF v_sync_origin IN ('hubspot_sync', 'hubspot_historical', 'hubspot_reconcile') THEN
    RETURN NEW;
  END IF;

  IF OLD.qualification_status IS DISTINCT FROM NEW.qualification_status THEN
    INSERT INTO public.automation_events (
      event_type,
      lead_id,
      source_table,
      source_record_id,
      source_event_key,
      payload
    ) VALUES (
      'qualification_status_changed',
      NEW.id,
      'leads',
      NEW.id::text,
      'qualification_status:' || NEW.id::text || ':' || COALESCE(NEW.qualification_status, 'none') || ':' || extract(epoch from now())::text,
      jsonb_build_object(
        'old_status', OLD.qualification_status,
        'new_status', NEW.qualification_status,
        'source', NEW.source,
        'source_detail', NEW.source_detail
      )
    )
    ON CONFLICT (source_event_key) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_capture_lead_created_event() IS
  'Captures lead_created automation events with defense-in-depth suppression for HubSpot sync, CSV imports, and test leads.';

COMMENT ON FUNCTION public.trg_capture_qualification_status_changed_event() IS
  'Captures qualification_status_changed automation events with suppression during HubSpot sync and reconciliation.';
