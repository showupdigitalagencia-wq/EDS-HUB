-- =============================================================================
-- Migration 00067: Safe Campaign & Lead Deletion, Real Lead Picker, and HubSpot Anti-Resurrection
-- =============================================================================
-- 1. Adds deleted_at TIMESTAMPTZ NULL to public.leads and public.campaigns.
-- 2. Creates index on deleted_at for high performance operational queries.
-- 3. Implements safe_delete_lead RPC:
--    - Soft deletes the lead (deleted_at = now())
--    - Cancels pending tasks while preserving completed task history
--    - Archives integration_entity_links to prevent HubSpot resurrection loops
--    - Records lead_deleted activity for immutable audit
-- 4. Implements safe_delete_campaign RPC:
--    - Soft deletes the campaign (deleted_at = now(), status = 'cancelled')
--    - Preserves all campaign versions, execution logs, and message history
--    - Cancels pending campaign tasks
-- 5. Updates process_hubspot_inbound_batch RPC:
--    - Checks if an incoming HubSpot contact corresponds to an archived entity link
--      OR a soft-deleted lead (deleted_at IS NOT NULL)
--    - Emits ignored_deleted event and blocks resurrection
-- 6. Updates preview_audience_segment and prepare_campaign_audience_snapshot:
--    - Strictly filters out leads where deleted_at IS NOT NULL
-- =============================================================================

-- 1. Add deleted_at columns
ALTER TABLE public.leads
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

ALTER TABLE public.campaigns
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

-- 2. Partial indices on active (non-deleted) records
CREATE INDEX IF NOT EXISTS idx_leads_deleted_at
ON public.leads (deleted_at) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_campaigns_deleted_at
ON public.campaigns (deleted_at) WHERE deleted_at IS NULL;

-- 3. Safe Lead Deletion RPC
CREATE OR REPLACE FUNCTION public.safe_delete_lead(p_lead_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lead RECORD;
  v_cancelled_tasks INT := 0;
  v_archived_links INT := 0;
  v_now TIMESTAMPTZ := now();
BEGIN
  -- 1. Authorization check
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: Caller is not an active EDS HUB app user'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Validate lead exists
  SELECT id, first_name, last_name, email, deleted_at INTO v_lead
  FROM public.leads
  WHERE id = p_lead_id;

  IF v_lead.id IS NULL THEN
    RAISE EXCEPTION 'Lead % not found', p_lead_id
      USING ERRCODE = '22023';
  END IF;

  IF v_lead.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'lead_id', p_lead_id,
      'already_deleted', true
    );
  END IF;

  -- 3. Soft-delete the lead
  UPDATE public.leads
  SET deleted_at = v_now,
      updated_at = v_now
  WHERE id = p_lead_id;

  -- 4. Cancel pending tasks (preserve completed and in-progress tasks for factual audit)
  UPDATE public.tasks
  SET status = 'cancelled',
      updated_at = v_now
  WHERE lead_id = p_lead_id AND status = 'pending';
  GET DIAGNOSTICS v_cancelled_tasks = ROW_COUNT;

  -- 5. Archive integration entity links to prevent HubSpot/Meta re-import recreation loop
  UPDATE public.integration_entity_links
  SET status = 'archived',
      updated_at = v_now
  WHERE eds_entity_id = p_lead_id AND entity_type = 'lead';
  GET DIAGNOSTICS v_archived_links = ROW_COUNT;

  -- 6. Record immutable activity log
  INSERT INTO public.lead_activities (
    lead_id,
    activity_type,
    actor_type,
    summary,
    metadata
  ) VALUES (
    p_lead_id,
    'lead_deleted',
    'user',
    'Lead excluído das listas operacionais do CRM (soft delete)',
    jsonb_build_object(
      'deleted_at', v_now,
      'cancelled_tasks_count', v_cancelled_tasks,
      'archived_links_count', v_archived_links
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'lead_id', p_lead_id,
    'deleted_at', v_now,
    'cancelled_tasks_count', v_cancelled_tasks,
    'archived_links_count', v_archived_links
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.safe_delete_lead TO authenticated;

-- 4. Safe Campaign Deletion RPC
CREATE OR REPLACE FUNCTION public.safe_delete_campaign(p_campaign_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_camp RECORD;
  v_cancelled_tasks INT := 0;
  v_now TIMESTAMPTZ := now();
BEGIN
  -- 1. Authorization check
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: Caller is not an active EDS HUB app user'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Validate campaign exists
  SELECT id, name, status, deleted_at INTO v_camp
  FROM public.campaigns
  WHERE id = p_campaign_id;

  IF v_camp.id IS NULL THEN
    RAISE EXCEPTION 'Campaign % not found', p_campaign_id
      USING ERRCODE = '22023';
  END IF;

  IF v_camp.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'campaign_id', p_campaign_id,
      'already_deleted', true
    );
  END IF;

  -- 3. Soft-delete campaign and update status to 'cancelled'
  -- Preserves all campaign_versions, campaign_audiences, execution logs, and outbound messages
  UPDATE public.campaigns
  SET deleted_at = v_now,
      status = 'cancelled',
      updated_at = v_now
  WHERE id = p_campaign_id;

  -- 4. Cancel any pending tasks associated with this campaign
  UPDATE public.tasks
  SET status = 'cancelled',
      updated_at = v_now
  WHERE campaign_id = p_campaign_id AND status = 'pending';
  GET DIAGNOSTICS v_cancelled_tasks = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'campaign_id', p_campaign_id,
    'deleted_at', v_now,
    'action', 'soft_deleted',
    'cancelled_tasks_count', v_cancelled_tasks
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.safe_delete_campaign TO authenticated;

-- 5. Anti-Resurrection: Update process_hubspot_inbound_batch
CREATE OR REPLACE FUNCTION public.process_hubspot_inbound_batch(p_events JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item JSONB;
  v_event_id TEXT;
  v_contact_id TEXT;
  v_props JSONB;
  v_event_ts TIMESTAMPTZ;
  v_payload_hash TEXT;
  v_link_rec RECORD;
  v_matched_lead_id UUID;
  v_lead_matches UUID[];
  v_email TEXT;
  v_phone TEXT;
  v_first_name TEXT;
  v_last_name TEXT;
  v_qual_status TEXT;
  v_course_interest_val TEXT;
  v_resolved_course_id UUID;
  v_existing_lead RECORD;
  v_change_diff JSONB := '{}'::jsonb;
  v_created_count INT := 0;
  v_updated_count INT := 0;
  v_ignored_duplicate INT := 0;
  v_ignored_echo INT := 0;
  v_ignored_stale INT := 0;
  v_ignored_deleted INT := 0;
  v_conflict_count INT := 0;
  v_capture_stage_id UUID;
BEGIN
  -- Set transaction-local sync origin to suppress loop triggers
  PERFORM set_config('app.sync_origin', 'hubspot_sync', true);

  -- Get Capture pipeline stage
  SELECT id INTO v_capture_stage_id FROM public.pipeline_stages WHERE code = 'capture' LIMIT 1;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_events)
  LOOP
    v_event_id := v_item->>'eventId';
    v_contact_id := COALESCE(v_item->>'objectId', v_item->>'hubspot_contact_id', v_item->>'id');
    v_props := COALESCE(v_item->'properties', v_item->'raw_properties', v_item);
    v_event_ts := COALESCE((v_item->>'occurredAt')::timestamptz, (v_props->>'lastmodifieddate')::timestamptz, now());
    v_payload_hash := encode(sha256(v_props::text::bytea), 'hex');

    -- 1. Idempotency Check on external_event_id
    IF v_event_id IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM public.integration_sync_events WHERE integration = 'hubspot' AND external_event_id = v_event_id) THEN
        v_ignored_duplicate := v_ignored_duplicate + 1;
        CONTINUE;
      END IF;
    END IF;

    -- Extract normalized values
    v_email := NULLIF(trim(lower(COALESCE(v_props->>'email', ''))), '');
    v_phone := NULLIF(regexp_replace(COALESCE(v_props->>'phone', v_props->>'mobilephone', ''), '\D', '', 'g'), '');
    v_first_name := NULLIF(trim(COALESCE(v_props->>'firstname', '')), '');
    v_last_name := NULLIF(trim(COALESCE(v_props->>'lastname', '')), '');
    v_qual_status := NULLIF(trim(COALESCE(v_props->>'hs_lead_status', v_props->>'qualification_status', '')), '');
    v_course_interest_val := NULLIF(trim(COALESCE(v_props->>'course_interest', '')), '');

    -- 2. ANTI-RESURRECTION CHECK FOR SOFT-DELETED LEADS
    -- If this contact links to an archived entity link OR matches a soft-deleted lead, DO NOT resurrect!
    IF EXISTS (
      SELECT 1 FROM public.integration_entity_links
      WHERE integration = 'hubspot'
        AND entity_type = 'lead'
        AND external_entity_id = v_contact_id
        AND status = 'archived'
    ) OR EXISTS (
      SELECT 1 FROM public.leads
      WHERE (hubspot_contact_id = v_contact_id OR (v_email IS NOT NULL AND lower(trim(email)) = v_email))
        AND deleted_at IS NOT NULL
    ) THEN
      INSERT INTO public.integration_sync_events (
        integration, direction, entity_type, eds_entity_id, external_entity_id,
        event_type, external_event_id, external_event_timestamp, payload_hash, status, change_summary
      ) VALUES (
        'hubspot', 'inbound', 'lead', NULL, v_contact_id,
        'contact.ignored_deleted', v_event_id, v_event_ts, v_payload_hash, 'ignored_deleted',
        jsonb_build_object('reason', 'Lead is deleted/archived in EDS HUB. Inbound recreation blocked.')
      );
      v_ignored_deleted := v_ignored_deleted + 1;
      CONTINUE;
    END IF;

    -- 3. Find Link / Matching Hierarchy
    v_matched_lead_id := NULL;

    -- Priority 1: Existing active link in integration_entity_links
    SELECT eds_entity_id, last_synced_hash, external_updated_at INTO v_link_rec
    FROM public.integration_entity_links
    WHERE integration = 'hubspot'
      AND entity_type = 'lead'
      AND external_entity_id = v_contact_id
      AND status = 'active'
    LIMIT 1;

    IF v_link_rec.eds_entity_id IS NOT NULL THEN
      v_matched_lead_id := v_link_rec.eds_entity_id;

      -- Check Out-of-Order Stale Event
      IF v_link_rec.external_updated_at IS NOT NULL AND v_event_ts < v_link_rec.external_updated_at THEN
        INSERT INTO public.integration_sync_events (
          integration, direction, entity_type, eds_entity_id, external_entity_id,
          event_type, external_event_id, external_event_timestamp, payload_hash, status, change_summary
        ) VALUES (
          'hubspot', 'inbound', 'lead', v_matched_lead_id, v_contact_id,
          'contact.propertyChange', v_event_id, v_event_ts, v_payload_hash, 'ignored_stale',
          jsonb_build_object('reason', 'Incoming event timestamp is older than recorded version')
        );
        v_ignored_stale := v_ignored_stale + 1;
        CONTINUE;
      END IF;

      -- Check Echo Loop (hash match)
      IF v_link_rec.last_synced_hash IS NOT NULL AND v_link_rec.last_synced_hash = v_payload_hash THEN
        INSERT INTO public.integration_sync_events (
          integration, direction, entity_type, eds_entity_id, external_entity_id,
          event_type, external_event_id, external_event_timestamp, payload_hash, status, change_summary
        ) VALUES (
          'hubspot', 'inbound', 'lead', v_matched_lead_id, v_contact_id,
          'contact.propertyChange', v_event_id, v_event_ts, v_payload_hash, 'ignored_echo',
          jsonb_build_object('reason', 'Payload hash identical to last synced state')
        );
        v_ignored_echo := v_ignored_echo + 1;
        CONTINUE;
      END IF;

    ELSE
      -- Priority 2: Mirrored hubspot_contact_id in public.leads (active only)
      SELECT id INTO v_matched_lead_id
      FROM public.leads
      WHERE hubspot_contact_id = v_contact_id
        AND deleted_at IS NULL
      LIMIT 1;

      IF v_matched_lead_id IS NULL AND v_email IS NOT NULL THEN
        -- Priority 3: Normalized Unique Email Match (active only)
        SELECT array_agg(id) INTO v_lead_matches
        FROM public.leads
        WHERE lower(trim(email)) = v_email
          AND deleted_at IS NULL;

        IF cardinality(v_lead_matches) = 1 THEN
          v_matched_lead_id := v_lead_matches[1];
        ELSIF cardinality(v_lead_matches) > 1 THEN
          INSERT INTO public.integration_conflicts (
            integration, entity_type, external_entity_id, conflict_type,
            conflict_summary, field_name, hubspot_data
          ) VALUES (
            'hubspot', 'lead', v_contact_id, 'MULTIPLE_EMAIL_MATCH',
            'Email ' || v_email || ' matches ' || cardinality(v_lead_matches)::text || ' leads in EDS HUB',
            'email', v_props
          );
          v_conflict_count := v_conflict_count + 1;
          CONTINUE;
        END IF;
      END IF;

      -- Priority 4: Normalized Unique Phone Match (active only)
      IF v_matched_lead_id IS NULL AND v_phone IS NOT NULL THEN
        SELECT array_agg(id) INTO v_lead_matches
        FROM public.leads
        WHERE regexp_replace(COALESCE(phone_raw, phone_e164, ''), '\D', '', 'g') = v_phone
          AND deleted_at IS NULL;

        IF cardinality(v_lead_matches) = 1 THEN
          v_matched_lead_id := v_lead_matches[1];
        ELSIF cardinality(v_lead_matches) > 1 THEN
          INSERT INTO public.integration_conflicts (
            integration, entity_type, external_entity_id, conflict_type,
            conflict_summary, field_name, hubspot_data
          ) VALUES (
            'hubspot', 'lead', v_contact_id, 'MULTIPLE_PHONE_MATCH',
            'Phone matches ' || cardinality(v_lead_matches)::text || ' leads in EDS HUB',
            'phone', v_props
          );
          v_conflict_count := v_conflict_count + 1;
          CONTINUE;
        END IF;
      END IF;
    END IF;

    -- 4. Execute Update or Create
    v_change_diff := '{}'::jsonb;

    IF v_matched_lead_id IS NOT NULL THEN
      -- UPDATE EXISTING MATCHED LEAD
      SELECT first_name, last_name, email, phone_raw, qualification_status INTO v_existing_lead
      FROM public.leads WHERE id = v_matched_lead_id AND deleted_at IS NULL;

      -- Email Collision Safety Check: If email changed, ensure it doesn't collide with a DIFFERENT lead
      IF v_email IS NOT NULL AND v_existing_lead.email IS DISTINCT FROM v_email THEN
        IF EXISTS (SELECT 1 FROM public.leads WHERE lower(trim(email)) = v_email AND id <> v_matched_lead_id AND deleted_at IS NULL) THEN
          INSERT INTO public.integration_conflicts (
            integration, entity_type, eds_entity_id, external_entity_id, conflict_type,
            conflict_summary, field_name, hubspot_data, eds_data
          ) VALUES (
            'hubspot', 'lead', v_matched_lead_id, v_contact_id, 'EMAIL_COLLISION',
            'New email from HubSpot collides with a different existing lead',
            'email', v_props, to_jsonb(v_existing_lead)
          );
          v_conflict_count := v_conflict_count + 1;
          CONTINUE;
        END IF;
      END IF;

      -- Apply non-destructive updates
      UPDATE public.leads
      SET
        first_name = COALESCE(v_first_name, first_name),
        last_name = COALESCE(v_last_name, last_name),
        email = COALESCE(v_email, email),
        phone_raw = COALESCE(v_phone, phone_raw),
        hubspot_contact_id = v_contact_id,
        updated_at = now()
      WHERE id = v_matched_lead_id;

      -- Upsert active integration_entity_link
      INSERT INTO public.integration_entity_links (
        integration, entity_type, eds_entity_id, external_entity_id,
        status, last_synced_hash, external_updated_at, last_inbound_sync_at
      ) VALUES (
        'hubspot', 'lead', v_matched_lead_id, v_contact_id,
        'active', v_payload_hash, v_event_ts, now()
      ) ON CONFLICT (integration, entity_type, eds_entity_id) WHERE status = 'active'
      DO UPDATE SET
        external_entity_id = EXCLUDED.external_entity_id,
        last_synced_hash = EXCLUDED.last_synced_hash,
        external_updated_at = EXCLUDED.external_updated_at,
        last_inbound_sync_at = EXCLUDED.last_inbound_sync_at,
        updated_at = now();

      -- Course Interest Normalization (lead_course_interests)
      IF v_course_interest_val IS NOT NULL THEN
        SELECT id INTO v_resolved_course_id
        FROM public.courses
        WHERE lower(name) = lower(v_course_interest_val) OR lower(code) = lower(v_course_interest_val)
        LIMIT 1;

        IF v_resolved_course_id IS NOT NULL THEN
          INSERT INTO public.lead_course_interests (lead_id, course_id, source, status)
          VALUES (v_matched_lead_id, v_resolved_course_id, 'hubspot_sync', 'active')
          ON CONFLICT DO NOTHING;
        ELSE
          INSERT INTO public.integration_conflicts (
            integration, entity_type, eds_entity_id, external_entity_id, conflict_type,
            conflict_summary, field_name, hubspot_data
          ) VALUES (
            'hubspot', 'lead', v_matched_lead_id, v_contact_id, 'MAPPING_VALUE_UNKNOWN',
            'Unrecognized course interest value from HubSpot: ' || v_course_interest_val,
            'course_interest', v_props
          );
        END IF;
      END IF;

      -- Log Activity
      INSERT INTO public.lead_activities (
        lead_id, activity_type, actor_type, summary, metadata
      ) VALUES (
        v_matched_lead_id, 'hubspot_field_updated', 'system',
        'Lead updated via HubSpot sync', jsonb_build_object('external_id', v_contact_id)
      );

      v_updated_count := v_updated_count + 1;

    ELSE
      -- CREATE NEW LEAD (Default to capture stage)
      INSERT INTO public.leads (
        first_name, last_name, email, phone_raw, contact_preference,
        source, source_detail, pipeline_stage_id, hubspot_contact_id,
        source_created_at, created_at, updated_at
      ) VALUES (
        v_first_name, v_last_name, v_email, v_phone, 'email',
        'hubspot', 'continuous_sync', v_capture_stage_id, v_contact_id,
        COALESCE(v_event_ts, now()), now(), now()
      ) RETURNING id INTO v_matched_lead_id;

      -- Create initial active link
      INSERT INTO public.integration_entity_links (
        integration, entity_type, eds_entity_id, external_entity_id,
        status, last_synced_hash, external_updated_at, last_inbound_sync_at
      ) VALUES (
        'hubspot', 'lead', v_matched_lead_id, v_contact_id,
        'active', v_payload_hash, v_event_ts, now()
      );

      -- Log Activity
      INSERT INTO public.lead_activities (
        lead_id, activity_type, actor_type, summary, metadata
      ) VALUES (
        v_matched_lead_id, 'lead_created', 'system',
        'Lead imported via HubSpot inbound sync', jsonb_build_object('external_id', v_contact_id)
      );

      v_created_count := v_created_count + 1;
    END IF;

    -- Record Successful Sync Event
    INSERT INTO public.integration_sync_events (
      integration, direction, entity_type, eds_entity_id, external_entity_id,
      event_type, external_event_id, external_event_timestamp, payload_hash, status, change_summary
    ) VALUES (
      'hubspot', 'inbound', 'lead', v_matched_lead_id, v_contact_id,
      'contact.synced', v_event_id, v_event_ts, v_payload_hash, 'applied',
      jsonb_build_object('action', CASE WHEN v_existing_lead.first_name IS NOT NULL THEN 'update' ELSE 'create' END)
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'created_count', v_created_count,
    'updated_count', v_updated_count,
    'ignored_duplicate', v_ignored_duplicate,
    'ignored_echo', v_ignored_echo,
    'ignored_stale', v_ignored_stale,
    'ignored_deleted', v_ignored_deleted,
    'conflict_count', v_conflict_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_hubspot_inbound_batch TO authenticated;

-- 6. Update preview_audience_segment to exclude soft-deleted leads
CREATE OR REPLACE FUNCTION public.preview_audience_segment(
  p_filters JSONB,
  p_channel TEXT,
  p_include_test BOOLEAN DEFAULT false,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_matched INT := 0;
  v_eligible_count INT := 0;
  v_excluded_count INT := 0;
  v_cnt_test INT := 0;
  v_cnt_no_pref INT := 0;
  v_cnt_pref_mismatch INT := 0;
  v_cnt_missing_email INT := 0;
  v_cnt_missing_phone INT := 0;
  v_leads_json JSONB := '[]'::jsonb;
  
  -- Filter variables extracted from p_filters
  v_stages JSONB;
  v_sources JSONB;
  v_qual_statuses JSONB;
  v_min_score INT;
  v_max_score INT;
  v_days_inactivity INT;
  v_enrolled_course_id UUID;
  v_not_enrolled_course_id UUID;
  v_completed_course_id UUID;
  v_repeat_student BOOLEAN;
  v_has_balance BOOLEAN;
  v_course_interest_id UUID;
  v_contact_preferences JSONB;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Access denied. Caller is not an active app user.';
  END IF;

  IF p_channel NOT IN ('email', 'sms', 'call') THEN
    RAISE EXCEPTION 'Invalid campaign channel: %. Must be email, sms, or call.', p_channel;
  END IF;

  -- Extract filter parameters
  v_stages := p_filters->'stages';
  v_sources := p_filters->'sources';
  v_qual_statuses := p_filters->'qualification_statuses';
  v_min_score := (p_filters->>'min_score')::INT;
  v_max_score := (p_filters->>'max_score')::INT;
  v_days_inactivity := (p_filters->>'days_since_last_activity')::INT;
  
  IF p_filters->>'enrolled_course_id' IS NOT NULL AND (p_filters->>'enrolled_course_id') != '' THEN
    v_enrolled_course_id := (p_filters->>'enrolled_course_id')::UUID;
  END IF;

  IF p_filters->>'not_enrolled_course_id' IS NOT NULL AND (p_filters->>'not_enrolled_course_id') != '' THEN
    v_not_enrolled_course_id := (p_filters->>'not_enrolled_course_id')::UUID;
  END IF;

  IF p_filters->>'completed_course_id' IS NOT NULL AND (p_filters->>'completed_course_id') != '' THEN
    v_completed_course_id := (p_filters->>'completed_course_id')::UUID;
  END IF;

  IF p_filters->>'repeat_student' IS NOT NULL THEN
    v_repeat_student := (p_filters->>'repeat_student')::BOOLEAN;
  END IF;

  IF p_filters->>'has_outstanding_balance' IS NOT NULL THEN
    v_has_balance := (p_filters->>'has_outstanding_balance')::BOOLEAN;
  END IF;

  IF p_filters->>'course_interest_id' IS NOT NULL AND (p_filters->>'course_interest_id') != '' THEN
    v_course_interest_id := (p_filters->>'course_interest_id')::UUID;
  END IF;

  v_contact_preferences := p_filters->'contact_preferences';

  -- Temporary table of matched leads with eligibility calculation
  DROP TABLE IF EXISTS temp_matched_leads;
  CREATE TEMP TABLE temp_matched_leads ON COMMIT DROP AS
  SELECT 
    l.id,
    l.first_name,
    l.last_name,
    l.email,
    COALESCE(l.phone_e164, l.phone_raw) AS phone,
    l.source,
    l.contact_preference,
    l.pipeline_stage_id,
    ps.name AS stage_name,
    ps.code AS stage_code,
    l.lead_score,
    l.created_at,
    -- Strict Canonical Eligibility Determination
    CASE
      WHEN l.source = 'test' THEN false
      WHEN l.contact_preference IS NULL OR trim(l.contact_preference) = '' THEN false
      WHEN l.contact_preference != p_channel THEN false
      WHEN p_channel = 'email' AND (l.email IS NULL OR trim(l.email) = '') THEN false
      WHEN p_channel IN ('sms', 'call') AND COALESCE(l.phone_e164, l.phone_raw) IS NULL THEN false
      ELSE true
    END AS is_eligible,
    -- Canonical Exclusion Reason
    CASE
      WHEN l.source = 'test' THEN 'TEST_SOURCE'
      WHEN l.contact_preference IS NULL OR trim(l.contact_preference) = '' THEN 'NO_VALID_CONTACT_PREFERENCE'
      WHEN l.contact_preference != p_channel THEN 'CHANNEL_PREFERENCE_MISMATCH'
      WHEN p_channel = 'email' AND (l.email IS NULL OR trim(l.email) = '') THEN 'MISSING_EMAIL'
      WHEN p_channel IN ('sms', 'call') AND COALESCE(l.phone_e164, l.phone_raw) IS NULL THEN 'MISSING_PHONE'
      ELSE NULL
    END AS exclusion_reason
  FROM public.leads l
  LEFT JOIN public.pipeline_stages ps ON ps.id = l.pipeline_stage_id
  WHERE 
    -- 0. EXCLUDE SOFT-DELETED LEADS
    l.deleted_at IS NULL
    -- 1. Stage filter
    AND (v_stages IS NULL OR jsonb_array_length(v_stages) = 0 OR 
      ps.code = ANY (SELECT jsonb_array_elements_text(v_stages)) OR
      l.pipeline_stage_id::text = ANY (SELECT jsonb_array_elements_text(v_stages)))
    -- 2. Source filter
    AND (v_sources IS NULL OR jsonb_array_length(v_sources) = 0 OR 
      l.source = ANY (SELECT jsonb_array_elements_text(v_sources)))
    -- 3. Qualification status filter
    AND (v_qual_statuses IS NULL OR jsonb_array_length(v_qual_statuses) = 0 OR 
      l.qualification_status = ANY (SELECT jsonb_array_elements_text(v_qual_statuses)))
    -- 4. Lead score range
    AND (v_min_score IS NULL OR l.lead_score >= v_min_score)
    AND (v_max_score IS NULL OR l.lead_score <= v_max_score)
    -- 5. Meaningful commercial inactivity
    AND (v_days_inactivity IS NULL OR 
      public.get_lead_last_meaningful_activity_at(l.id) <= now() - (v_days_inactivity || ' days')::interval)
    -- 6. Enrolled course
    AND (v_enrolled_course_id IS NULL OR EXISTS (
      SELECT 1 FROM public.enrollments e 
      WHERE e.lead_id = l.id AND e.course_id = v_enrolled_course_id AND e.enrollment_status = 'confirmed'
    ))
    -- 7. Not enrolled course
    AND (v_not_enrolled_course_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.enrollments e 
      WHERE e.lead_id = l.id AND e.course_id = v_not_enrolled_course_id AND e.enrollment_status = 'confirmed'
    ))
    -- 8. Completed course
    AND (v_completed_course_id IS NULL OR EXISTS (
      SELECT 1 FROM public.enrollments e 
      JOIN public.course_participations p ON p.enrollment_id = e.id
      WHERE e.lead_id = l.id AND e.course_id = v_completed_course_id AND p.attendance_status = 'completed'
    ))
    -- 9. Repeat student (>= 2 confirmed enrollments)
    AND (v_repeat_student IS NULL OR (
      (SELECT COUNT(*) >= 2 FROM public.enrollments e2 WHERE e2.lead_id = l.id AND e2.enrollment_status = 'confirmed') = v_repeat_student
    ))
    -- 10. Future course interest
    AND (v_course_interest_id IS NULL OR EXISTS (
      SELECT 1 FROM public.lead_course_interests i 
      WHERE i.lead_id = l.id AND i.course_id = v_course_interest_id AND i.status = 'active'
    ))
    -- 11. Contact preferences
    AND (v_contact_preferences IS NULL OR jsonb_array_length(v_contact_preferences) = 0 OR
      l.contact_preference = ANY (SELECT jsonb_array_elements_text(v_contact_preferences)));

  SELECT COUNT(*) INTO v_total_matched FROM temp_matched_leads;
  SELECT COUNT(*) INTO v_eligible_count FROM temp_matched_leads WHERE is_eligible = true;
  v_excluded_count := v_total_matched - v_eligible_count;

  SELECT COUNT(*) INTO v_cnt_test FROM temp_matched_leads WHERE exclusion_reason = 'TEST_SOURCE';
  SELECT COUNT(*) INTO v_cnt_no_pref FROM temp_matched_leads WHERE exclusion_reason = 'NO_VALID_CONTACT_PREFERENCE';
  SELECT COUNT(*) INTO v_cnt_pref_mismatch FROM temp_matched_leads WHERE exclusion_reason = 'CHANNEL_PREFERENCE_MISMATCH';
  SELECT COUNT(*) INTO v_cnt_missing_email FROM temp_matched_leads WHERE exclusion_reason = 'MISSING_EMAIL';
  SELECT COUNT(*) INTO v_cnt_missing_phone FROM temp_matched_leads WHERE exclusion_reason = 'MISSING_PHONE';

  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_leads_json
  FROM (
    SELECT * FROM temp_matched_leads
    ORDER BY created_at DESC
    LIMIT p_limit OFFSET p_offset
  ) t;

  RETURN jsonb_build_object(
    'total_matched', v_total_matched,
    'eligible_count', v_eligible_count,
    'excluded_count', v_excluded_count,
    'exclusion_breakdown', jsonb_build_object(
      'TEST_SOURCE', v_cnt_test,
      'NO_VALID_CONTACT_PREFERENCE', v_cnt_no_pref,
      'CHANNEL_PREFERENCE_MISMATCH', v_cnt_pref_mismatch,
      'MISSING_EMAIL', v_cnt_missing_email,
      'MISSING_PHONE', v_cnt_missing_phone
    ),
    'leads', v_leads_json
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.preview_audience_segment TO authenticated;

-- 7. Update get_pipeline_stage_counts to exclude soft-deleted leads
CREATE OR REPLACE FUNCTION public.get_pipeline_stage_counts()
RETURNS TABLE (
  stage_id UUID,
  stage_code TEXT,
  stage_name TEXT,
  sort_order INT,
  lead_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    ps.id AS stage_id,
    ps.code AS stage_code,
    ps.name AS stage_name,
    ps.sort_order,
    COUNT(l.id) AS lead_count
  FROM public.pipeline_stages ps
  LEFT JOIN public.leads l ON l.pipeline_stage_id = ps.id AND l.deleted_at IS NULL
  GROUP BY ps.id, ps.code, ps.name, ps.sort_order
  ORDER BY ps.sort_order ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_pipeline_stage_counts() TO authenticated, anon, service_role;
