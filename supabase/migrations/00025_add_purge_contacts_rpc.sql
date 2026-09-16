-- =============================================================================
-- Migration 00025: Create secure RPC to purge all contacts and related data
-- =============================================================================

-- 1. Preview RPC: returns counts of contacts and dependent records
CREATE OR REPLACE FUNCTION public.get_contacts_purge_preview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

-- 2. Purge RPC: atomically deletes all contacts and dependent CRM data
CREATE OR REPLACE FUNCTION public.purge_all_contacts(confirmation_text text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  IF confirmation_text IS NULL OR confirmation_text <> 'DELETE ALL CONTACTS' THEN
    RAISE EXCEPTION 'Invalid confirmation text. You must type DELETE ALL CONTACTS' USING ERRCODE = '22023';
  END IF;

  -- 1. outbound_messages (resolves RESTRICT on leads & lead_intake_events)
  WITH deleted AS (
    DELETE FROM public.outbound_messages RETURNING id
  )
  SELECT count(*) INTO v_deleted_outbound_messages FROM deleted;

  -- 2. tasks (resolves RESTRICT on leads)
  WITH deleted AS (
    DELETE FROM public.tasks RETURNING id
  )
  SELECT count(*) INTO v_deleted_tasks FROM deleted;

  -- 3. lead_activities (resolves RESTRICT on leads)
  WITH deleted AS (
    DELETE FROM public.lead_activities RETURNING id
  )
  SELECT count(*) INTO v_deleted_activities FROM deleted;

  -- 4. lead_stage_history (resolves RESTRICT on leads)
  WITH deleted AS (
    DELETE FROM public.lead_stage_history RETURNING id
  )
  SELECT count(*) INTO v_deleted_stage_history FROM deleted;

  -- 5. campaign_recipients (linked to leads)
  WITH deleted AS (
    DELETE FROM public.campaign_recipients WHERE lead_id IS NOT NULL RETURNING id
  )
  SELECT count(*) INTO v_deleted_campaign_recipients FROM deleted;

  -- 6. lead_tags (junction table between leads and tags)
  WITH deleted AS (
    DELETE FROM public.lead_tags RETURNING lead_id
  )
  SELECT count(*) INTO v_deleted_lead_tags FROM deleted;

  -- 7. lead_notes (notes on leads)
  WITH deleted AS (
    DELETE FROM public.lead_notes RETURNING id
  )
  SELECT count(*) INTO v_deleted_notes FROM deleted;

  -- 8. lead_import_rows (import row history)
  WITH deleted AS (
    DELETE FROM public.lead_import_rows RETURNING id
  )
  SELECT count(*) INTO v_deleted_import_rows FROM deleted;

  -- 9. lead_imports (import job records)
  WITH deleted AS (
    DELETE FROM public.lead_imports RETURNING id
  )
  SELECT count(*) INTO v_deleted_imports FROM deleted;

  -- 10. lead_intake_events (all RESTRICT children outbound_messages, tasks, activities are cleared)
  WITH deleted AS (
    DELETE FROM public.lead_intake_events RETURNING id
  )
  SELECT count(*) INTO v_deleted_intake_events FROM deleted;

  -- 11. leads (all RESTRICT and child tables are cleared)
  WITH deleted AS (
    DELETE FROM public.leads RETURNING id
  )
  SELECT count(*) INTO v_deleted_leads FROM deleted;

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

-- Grant permissions: only authenticated users (and strictly checked for is_active_app_user inside)
REVOKE ALL ON FUNCTION public.get_contacts_purge_preview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_contacts_purge_preview() TO authenticated;

REVOKE ALL ON FUNCTION public.purge_all_contacts(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purge_all_contacts(text) TO authenticated;
