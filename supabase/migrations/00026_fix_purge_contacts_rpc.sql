-- =============================================================================
-- Migration 00026: Fix and optimize contact purge RPC with explicit statement_timeout and WHERE PK IS NOT NULL
-- =============================================================================

-- 1. Preview RPC: returns counts of contacts and dependent records
CREATE OR REPLACE FUNCTION public.get_contacts_purge_preview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
DECLARE
  v_leads_count int;
  v_activities_count int;
  v_notes_count int;
  v_tasks_count int;
  v_imports_count int;
  v_import_rows_count int;
  v_intake_events_count int;
  v_outbound_messages_count int;
  v_campaign_recipients_count int;
  v_lead_tags_count int;
BEGIN
  -- Strict Authorization: Must be authenticated and an active app_user
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Forbidden: active app_user required' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_leads_count FROM public.leads;
  SELECT count(*) INTO v_activities_count FROM public.lead_activities;
  SELECT count(*) INTO v_notes_count FROM public.lead_notes;
  SELECT count(*) INTO v_tasks_count FROM public.tasks WHERE lead_id IS NOT NULL;
  SELECT count(*) INTO v_imports_count FROM public.lead_imports;
  SELECT count(*) INTO v_import_rows_count FROM public.lead_import_rows;
  SELECT count(*) INTO v_intake_events_count FROM public.lead_intake_events;
  SELECT count(*) INTO v_outbound_messages_count FROM public.outbound_messages WHERE lead_id IS NOT NULL OR intake_event_id IS NOT NULL;
  SELECT count(*) INTO v_campaign_recipients_count FROM public.campaign_recipients WHERE lead_id IS NOT NULL;
  SELECT count(*) INTO v_lead_tags_count FROM public.lead_tags;

  RETURN jsonb_build_object(
    'leads_count', v_leads_count,
    'activities_count', v_activities_count,
    'notes_count', v_notes_count,
    'tasks_count', v_tasks_count,
    'imports_count', v_imports_count,
    'import_rows_count', v_import_rows_count,
    'intake_events_count', v_intake_events_count,
    'outbound_messages_count', v_outbound_messages_count,
    'campaign_recipients_count', v_campaign_recipients_count,
    'lead_tags_count', v_lead_tags_count
  );
END;
$$;

-- 2. Purge RPC: atomically deletes all contacts and dependent CRM data with safeupdate-compliant WHERE clauses
CREATE OR REPLACE FUNCTION public.purge_all_contacts(confirmation_text text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
DECLARE
  v_deleted_leads int;
  v_deleted_activities int;
  v_deleted_notes int;
  v_deleted_tasks int;
  v_deleted_imports int;
  v_deleted_import_rows int;
  v_deleted_intake_events int;
  v_deleted_outbound_messages int;
  v_deleted_campaign_recipients int;
  v_deleted_stage_history int;
  v_deleted_lead_tags int;
BEGIN
  -- Strict Authorization: Must be authenticated and an active app_user
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Forbidden: active app_user required' USING ERRCODE = '42501';
  END IF;

  -- Exact Confirmation Text Validation
  IF confirmation_text IS NULL OR trim(confirmation_text) <> 'DELETE ALL CONTACTS' THEN
    RAISE EXCEPTION 'Invalid confirmation text. You must type DELETE ALL CONTACTS' USING ERRCODE = '22023';
  END IF;

  -- 1. outbound_messages (resolves RESTRICT on leads & lead_intake_events)
  DELETE FROM public.outbound_messages WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_outbound_messages = ROW_COUNT;

  -- 2. tasks (resolves RESTRICT on leads)
  DELETE FROM public.tasks WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_tasks = ROW_COUNT;

  -- 3. lead_activities (resolves RESTRICT on leads)
  DELETE FROM public.lead_activities WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_activities = ROW_COUNT;

  -- 4. lead_stage_history (resolves RESTRICT on leads)
  DELETE FROM public.lead_stage_history WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_stage_history = ROW_COUNT;

  -- 5. campaign_recipients (linked to leads)
  DELETE FROM public.campaign_recipients WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_campaign_recipients = ROW_COUNT;

  -- 6. lead_tags (junction table between leads and tags, PK is composite lead_id, tag_id)
  DELETE FROM public.lead_tags WHERE lead_id IS NOT NULL AND tag_id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_lead_tags = ROW_COUNT;

  -- 7. lead_notes (notes on leads)
  DELETE FROM public.lead_notes WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_notes = ROW_COUNT;

  -- 8. lead_import_rows (import row history)
  DELETE FROM public.lead_import_rows WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_import_rows = ROW_COUNT;

  -- 9. lead_imports (import job records)
  DELETE FROM public.lead_imports WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_imports = ROW_COUNT;

  -- 10. lead_intake_events (all RESTRICT children outbound_messages, tasks, activities are cleared)
  DELETE FROM public.lead_intake_events WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_intake_events = ROW_COUNT;

  -- 11. leads (all RESTRICT and child tables are cleared)
  DELETE FROM public.leads WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_deleted_leads = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_leads', v_deleted_leads,
    'deleted_activities', v_deleted_activities,
    'deleted_notes', v_deleted_notes,
    'deleted_tasks', v_deleted_tasks,
    'deleted_imports', v_deleted_imports,
    'deleted_import_rows', v_deleted_import_rows,
    'deleted_intake_events', v_deleted_intake_events,
    'deleted_outbound_messages', v_deleted_outbound_messages,
    'deleted_campaign_recipients', v_deleted_campaign_recipients,
    'deleted_stage_history', v_deleted_stage_history,
    'deleted_lead_tags', v_deleted_lead_tags
  );
END;
$$;

-- Grant permissions: only authenticated users and service_role
REVOKE ALL ON FUNCTION public.get_contacts_purge_preview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_contacts_purge_preview() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.purge_all_contacts(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purge_all_contacts(text) TO authenticated, service_role;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
