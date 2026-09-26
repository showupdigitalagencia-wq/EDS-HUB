-- =============================================================================
-- Migration 00069: Fix process_hubspot_inbound_batch unassigned record reference
-- =============================================================================
-- In PL/pgSQL, referencing v_existing_lead on unassigned branch raises an error.
-- This migration fixes v_is_update tracking and adds lead_intake_events persistence
-- for website-attributed leads.
-- =============================================================================

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
  v_target_stage_id UUID;
  v_source TEXT;
  v_source_detail TEXT;
  v_contact_pref TEXT;
  v_raw_analytics_1 TEXT;
  v_raw_analytics_src TEXT;
  v_is_update BOOLEAN := false;
BEGIN
  -- Set transaction-local sync origin to suppress loop triggers
  PERFORM set_config('app.sync_origin', 'hubspot_sync', true);

  -- Get default Capture pipeline stage ('Novo Lead')
  SELECT id INTO v_capture_stage_id FROM public.pipeline_stages WHERE code = 'capture' LIMIT 1;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_events)
  LOOP
    v_is_update := false;
    v_event_id := v_item->>'eventId';
    v_contact_id := COALESCE(v_item->>'objectId', v_item->>'hubspot_contact_id', v_item->>'id');
    v_props := COALESCE(v_item->'properties', v_item->'raw_properties', v_item);
    v_event_ts := COALESCE((v_item->>'occurredAt')::timestamptz, (v_props->>'lastmodifieddate')::timestamptz, (v_props->>'createdate')::timestamptz, now());
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
    v_qual_status := NULLIF(trim(COALESCE(v_props->>'status_de_qualificacao', v_props->>'hs_lead_status', v_props->>'qualification_status', '')), '');
    v_course_interest_val := NULLIF(trim(COALESCE(v_props->>'curso_de_interesse', v_props->>'course_interest', '')), '');

    -- Contact preference extraction (do NOT default to email)
    v_contact_pref := NULLIF(trim(lower(COALESCE(v_props->>'contact_preference', v_props->>'preferencia_de_contato', v_props->>'preferred_contact_method', ''))), '');
    IF v_contact_pref NOT IN ('email', 'sms', 'call', 'whatsapp') THEN
      v_contact_pref := NULL;
    END IF;

    -- Website vs HubSpot source attribution
    v_raw_analytics_1 := lower(COALESCE(v_props->>'hs_analytics_source_data_1', ''));
    v_raw_analytics_src := lower(COALESCE(v_props->>'hs_analytics_source', ''));
    IF v_raw_analytics_1 LIKE '%expdentalsolutions.com%' OR v_raw_analytics_1 LIKE '%website%' OR v_raw_analytics_src LIKE '%website%' THEN
      v_source := 'form';
      v_source_detail := 'website';
    ELSE
      v_source := 'hubspot';
      v_source_detail := 'continuous_sync';
    END IF;

    -- Pipeline stage resolution from status_de_qualificacao
    v_target_stage_id := NULL;
    IF v_qual_status IS NOT NULL THEN
      IF lower(v_qual_status) IN ('confirmado', 'confirmed', 'matricula', 'matrícula') THEN
        SELECT id INTO v_target_stage_id FROM public.pipeline_stages WHERE code = 'enrollment' LIMIT 1;
      ELSIF lower(v_qual_status) IN ('quente', 'hot', 'approval') THEN
        SELECT id INTO v_target_stage_id FROM public.pipeline_stages WHERE code = 'approval' LIMIT 1;
      ELSIF lower(v_qual_status) IN ('interessado', 'interested', 'acquisition') THEN
        SELECT id INTO v_target_stage_id FROM public.pipeline_stages WHERE code = 'acquisition' LIMIT 1;
      ELSIF lower(v_qual_status) IN ('alguma resposta', 'some_response', 'qualification') THEN
        SELECT id INTO v_target_stage_id FROM public.pipeline_stages WHERE code = 'qualification' LIMIT 1;
      END IF;
    END IF;
    IF v_target_stage_id IS NULL THEN
      v_target_stage_id := v_capture_stage_id;
    END IF;

    -- 2. ANTI-RESURRECTION CHECK FOR SOFT-DELETED LEADS
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
      v_is_update := true;
      SELECT first_name, last_name, email, phone_raw, qualification_status, pipeline_stage_id INTO v_existing_lead
      FROM public.leads WHERE id = v_matched_lead_id AND deleted_at IS NULL;

      -- Email Collision Safety Check
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
        contact_preference = COALESCE(v_contact_pref, contact_preference),
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

      -- Course Interest Normalization
      IF v_course_interest_val IS NOT NULL THEN
        SELECT id INTO v_resolved_course_id
        FROM public.courses
        WHERE lower(name) = lower(v_course_interest_val) 
           OR lower(code) = lower(v_course_interest_val)
           OR lower(name) LIKE '%' || lower(v_course_interest_val) || '%'
        LIMIT 1;

        IF v_resolved_course_id IS NOT NULL THEN
          INSERT INTO public.lead_course_interests (lead_id, course_id, source, status)
          VALUES (v_matched_lead_id, v_resolved_course_id, 'hubspot_sync', 'active')
          ON CONFLICT DO NOTHING;
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
      -- CREATE NEW LEAD
      v_is_update := false;
      INSERT INTO public.leads (
        first_name, last_name, email, phone_raw, contact_preference,
        source, source_detail, pipeline_stage_id, hubspot_contact_id,
        source_created_at, created_at, updated_at
      ) VALUES (
        v_first_name, v_last_name, v_email, v_phone, v_contact_pref,
        v_source, v_source_detail, v_target_stage_id, v_contact_id,
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

      -- Course Interest Normalization for new lead
      IF v_course_interest_val IS NOT NULL THEN
        SELECT id INTO v_resolved_course_id
        FROM public.courses
        WHERE lower(name) = lower(v_course_interest_val) 
           OR lower(code) = lower(v_course_interest_val)
           OR lower(name) LIKE '%' || lower(v_course_interest_val) || '%'
        LIMIT 1;

        IF v_resolved_course_id IS NOT NULL THEN
          INSERT INTO public.lead_course_interests (lead_id, course_id, source, status)
          VALUES (v_matched_lead_id, v_resolved_course_id, 'hubspot_sync', 'active')
          ON CONFLICT DO NOTHING;
        END IF;
      END IF;

      -- Also store lead_intake_events record for website attribution traceability
      IF v_source = 'form' THEN
        INSERT INTO public.lead_intake_events (
          source, source_detail, external_event_id, payload,
          status, lead_id, received_at
        ) VALUES (
          v_source, v_source_detail, v_contact_id, v_props,
          'applied', v_matched_lead_id, COALESCE(v_event_ts, now())
        );
      END IF;

      -- Log Activity
      INSERT INTO public.lead_activities (
        lead_id, activity_type, actor_type, summary, metadata
      ) VALUES (
        v_matched_lead_id, 'lead_created', 'system',
        'Lead imported via HubSpot inbound sync (' || v_source_detail || ')', jsonb_build_object('external_id', v_contact_id, 'source', v_source, 'source_detail', v_source_detail)
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
      jsonb_build_object('action', CASE WHEN v_is_update THEN 'update' ELSE 'create' END)
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
GRANT EXECUTE ON FUNCTION public.process_hubspot_inbound_batch TO service_role;
