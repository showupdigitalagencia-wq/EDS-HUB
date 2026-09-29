-- =============================================================================
-- Migration 00088: Fix HubSpot Inbound Batch Contact Extraction & Webhook Resilience
-- =============================================================================
-- Fixes critical production issue: HubSpot leads missing from EDS HUB
-- 1. Updates process_hubspot_inbound_batch to extract contact ID from:
--    COALESCE(v_event->>'contact_id', v_event->>'objectId', v_event->>'id', v_event->>'hubspot_contact_id', v_event->'properties'->>'hs_object_id')
-- 2. Normalizes v_props from COALESCE(v_event->'properties', v_event->'raw_properties', v_event)
-- 3. Robust Meta Lead Ads source detection (Instagram Lead, Facebook Lead Ads, PAID_SOCIAL)
-- 4. Course interest mapping with zero-data-loss fallback
-- 5. Contact preference normalization (email, sms, whatsapp, call)
-- 6. Canonical timestamp preservation (source_created_at from createdate)
-- 7. Audit & Observability logging to public.integration_sync_events
-- 8. Updates trigger_hubspot_reconcile with dual headers and 30-day lookback
-- =============================================================================

CREATE OR REPLACE FUNCTION public.process_hubspot_inbound_batch(p_events JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event JSONB;
  v_event_id TEXT;
  v_contact_id TEXT;
  v_props JSONB;
  v_email TEXT;
  v_phone TEXT;
  v_first_name TEXT;
  v_last_name TEXT;
  v_raw_course_interest TEXT;
  v_course_interest_val TEXT;
  v_contact_pref TEXT;
  v_source TEXT;
  v_source_detail TEXT;
  v_is_form_submission BOOLEAN;
  v_payload_hash TEXT;
  v_matched_lead_id UUID;
  v_lead_matches UUID[];
  v_event_ts TIMESTAMPTZ;
  v_source_created_at TIMESTAMPTZ;
  v_is_update BOOLEAN;
  v_created_count INT := 0;
  v_updated_count INT := 0;
  v_ignored_count INT := 0;
  v_conflict_count INT := 0;
  v_existing_course_interest TEXT;
  v_existing_course_interests JSONB;
  v_merged_course_interests JSONB;
  v_merged_course_interest TEXT;
  v_resolved_course_id UUID;
  v_qual_status TEXT;
  v_target_stage_id UUID;
  v_capture_stage_id UUID;
BEGIN
  -- Set transaction-local sync origin to suppress automated outreach loops
  PERFORM set_config('app.sync_origin', 'hubspot_reconcile', true);

  -- Retrieve default Capture pipeline stage ('Novo Lead')
  SELECT id INTO v_capture_stage_id FROM public.pipeline_stages WHERE code = 'capture' LIMIT 1;
  IF v_capture_stage_id IS NULL THEN
    SELECT id INTO v_capture_stage_id FROM public.pipeline_stages WHERE is_default = true LIMIT 1;
  END IF;

  FOR v_event IN SELECT * FROM jsonb_array_elements(p_events)
  LOOP
    BEGIN
      -- Extract contact ID from any supported key
      v_contact_id := COALESCE(
        v_event->>'contact_id',
        v_event->>'objectId',
        v_event->>'id',
        v_event->>'hubspot_contact_id',
        v_event->'properties'->>'hs_object_id'
      );

      IF v_contact_id IS NULL OR trim(v_contact_id) = '' THEN
        v_ignored_count := v_ignored_count + 1;
        CONTINUE;
      END IF;

      v_contact_id := trim(v_contact_id);
      v_event_id := COALESCE(v_event->>'eventId', v_event->>'id', v_contact_id || ':' || extract(epoch from now())::text);
      v_props := COALESCE(v_event->'properties', v_event->'raw_properties', v_event);

      -- Timestamps
      v_event_ts := COALESCE(
        (v_props->>'lastmodifieddate')::timestamptz,
        (v_event->>'occurredAt')::timestamptz,
        (v_event->>'timestamp')::timestamptz,
        now()
      );

      v_source_created_at := COALESCE(
        (v_props->>'createdate')::timestamptz,
        (v_props->>'hs_createdate')::timestamptz,
        (v_event->>'createdate')::timestamptz,
        v_event_ts,
        now()
      );

      v_payload_hash := md5(v_props::text);

      -- Normalize core identity fields
      v_email := NULLIF(lower(trim(COALESCE(v_props->>'email', v_event->>'email', ''))), '');
      v_phone := NULLIF(regexp_replace(COALESCE(v_props->>'phone', v_props->>'mobilephone', v_props->>'hs_calculated_phone_number', v_event->>'phone', ''), '\D', '', 'g'), '');
      v_first_name := NULLIF(trim(COALESCE(v_props->>'firstname', v_event->>'firstname', '')), '');
      v_last_name := NULLIF(trim(COALESCE(v_props->>'lastname', v_event->>'lastname', '')), '');

      -- Fallback for name if single field provided
      IF v_first_name IS NULL AND v_last_name IS NULL AND v_props->>'hs_full_name_or_email' IS NOT NULL THEN
        v_first_name := trim(v_props->>'hs_full_name_or_email');
      END IF;

      -- ANTI-RESURRECTION: Never resurrect soft-deleted leads
      IF EXISTS (
        SELECT 1 FROM public.integration_entity_links
        WHERE integration = 'hubspot'
          AND entity_type = 'lead'
          AND external_entity_id = v_contact_id
          AND status = 'archived'
      ) OR EXISTS (
        SELECT 1 FROM public.leads
        WHERE (hubspot_contact_id = v_contact_id OR (v_email IS NOT NULL AND lower(email) = v_email))
          AND deleted_at IS NOT NULL
      ) THEN
        v_ignored_count := v_ignored_count + 1;
        CONTINUE;
      END IF;

      -- Course interest detection (primary props + Meta ad titles + form names)
      v_raw_course_interest := COALESCE(
        v_props->>'curso_de_interesse',
        v_props->>'course_interest',
        v_props->>'qual_o_seu_interesse_',
        v_props->>'qual_o_seu_interesse',
        v_props->>'curso_de_interesse_2',
        v_props->>'curso_de_interesse_3',
        v_event->>'course_interest',
        v_event->>'course'
      );

      IF v_raw_course_interest IS NULL OR trim(v_raw_course_interest) = '' THEN
        IF lower(COALESCE(v_props->>'first_conversion_event_name', v_props->>'recent_conversion_event_name', v_props->>'form_name', '')) LIKE '%zygo%' THEN
          v_raw_course_interest := 'Zygomatic';
        ELSIF lower(COALESCE(v_props->>'first_conversion_event_name', v_props->>'recent_conversion_event_name', v_props->>'form_name', '')) LIKE '%wisdom%' OR
              lower(COALESCE(v_props->>'first_conversion_event_name', v_props->>'recent_conversion_event_name', v_props->>'form_name', '')) LIKE '%molar%' THEN
          v_raw_course_interest := 'Wisdom';
        ELSIF lower(COALESCE(v_props->>'first_conversion_event_name', v_props->>'recent_conversion_event_name', v_props->>'form_name', '')) LIKE '%endo%' THEN
          v_raw_course_interest := 'Endodontics';
        ELSIF lower(COALESCE(v_props->>'first_conversion_event_name', v_props->>'recent_conversion_event_name', v_props->>'form_name', '')) LIKE '%perio%' THEN
          v_raw_course_interest := 'Periodontal Plastic';
        ELSIF lower(COALESCE(v_props->>'first_conversion_event_name', v_props->>'recent_conversion_event_name', v_props->>'form_name', '')) LIKE '%rehab%' OR
              lower(COALESCE(v_props->>'first_conversion_event_name', v_props->>'recent_conversion_event_name', v_props->>'form_name', '')) LIKE '%reabilit%' THEN
          v_raw_course_interest := 'Rehabilitation';
        END IF;
      END IF;

      v_course_interest_val := NULLIF(trim(COALESCE(v_raw_course_interest, '')), '');

      -- Course Resolution to canonical courses
      v_resolved_course_id := NULL;
      IF v_course_interest_val IS NOT NULL THEN
        IF lower(v_course_interest_val) LIKE '%zygo%' THEN
          v_resolved_course_id := '58bc4c41-7914-42db-bc80-dd886123b9d5'::uuid;
          v_course_interest_val := 'Zygomatic';
        ELSIF lower(v_course_interest_val) LIKE '%wisdom%' OR lower(v_course_interest_val) LIKE '%molar%' THEN
          v_resolved_course_id := '3b306c26-a056-4da7-abe4-0a9af088e9f1'::uuid;
          v_course_interest_val := 'Wisdom';
        ELSIF lower(v_course_interest_val) LIKE '%endo%' THEN
          v_resolved_course_id := 'd0e576aa-7612-4042-90eb-3e3b2cc139cf'::uuid;
          v_course_interest_val := 'Endodontics';
        ELSIF lower(v_course_interest_val) LIKE '%perio%' THEN
          v_resolved_course_id := 'f386ca4a-13ad-42fb-8ef0-4bf1796fa26c'::uuid;
          v_course_interest_val := 'Periodontal Plastic';
        ELSIF lower(v_course_interest_val) LIKE '%rehab%' OR lower(v_course_interest_val) LIKE '%reabilit%' THEN
          v_resolved_course_id := '30ab31ed-8ba3-441a-937e-c30871f77117'::uuid;
          v_course_interest_val := 'Rehabilitation';
        ELSIF lower(v_course_interest_val) LIKE '%intensiv%' THEN
          v_resolved_course_id := 'b699036d-6c94-4734-bf32-4d96355a698c'::uuid;
          v_course_interest_val := 'Intensive Dental Implant Training';
        ELSIF lower(v_course_interest_val) LIKE '%advanced%' OR lower(v_course_interest_val) LIKE '%adie%' THEN
          v_resolved_course_id := 'e2e89057-0172-4dff-bb44-6e51cdf861a7'::uuid;
          v_course_interest_val := 'Advanced Dental Implant Experience';
        ELSE
          SELECT id INTO v_resolved_course_id
          FROM public.courses
          WHERE lower(name) = lower(v_course_interest_val)
             OR lower(code) = lower(v_course_interest_val)
             OR lower(name) LIKE '%' || lower(v_course_interest_val) || '%'
          LIMIT 1;
        END IF;
      END IF;

      -- Contact preference detection
      v_contact_pref := NULLIF(trim(lower(COALESCE(
        v_props->>'what_is_your_preferred_contact_method',
        v_props->>'what_is_your_preferred_method_of_contact',
        v_props->>'preferencia_de_contato',
        v_props->>'contact_preference',
        v_props->>'preferred_contact_method',
        ''
      ))), '');

      IF v_contact_pref IN ('whats', 'zap', 'whatsapp') THEN
        v_contact_pref := 'whatsapp';
      ELSIF v_contact_pref IN ('email', 'e-mail') THEN
        v_contact_pref := 'email';
      ELSIF v_contact_pref IN ('sms', 'text', 'text_message') THEN
        v_contact_pref := 'sms';
      ELSIF v_contact_pref IN ('phone', 'call', 'ligacao', 'telefone', 'phone_call') THEN
        v_contact_pref := 'call';
      ELSE
        v_contact_pref := NULL;
      END IF;

      -- Source attribution (Instagram, Facebook Lead Ads, Website, HubSpot)
      IF lower(COALESCE(v_props->>'origem_do_lead', '')) LIKE '%meta%' OR
         lower(COALESCE(v_props->>'origem_do_lead', '')) LIKE '%facebook%' OR
         lower(COALESCE(v_props->>'origem_do_lead', '')) LIKE '%instagram%' OR
         lower(COALESCE(v_props->>'lead_source', '')) LIKE '%meta%' OR
         lower(COALESCE(v_props->>'lead_source', '')) LIKE '%facebook%' OR
         lower(COALESCE(v_props->>'lead_source', '')) LIKE '%instagram%' OR
         lower(COALESCE(v_props->>'hs_analytics_source', '')) = 'paid_social' OR
         lower(COALESCE(v_props->>'first_conversion_event_name', '')) LIKE '%facebook lead ads%' OR
         lower(COALESCE(v_props->>'recent_conversion_event_name', '')) LIKE '%facebook lead ads%' THEN
        v_source := 'meta';
        v_source_detail := 'meta_lead_ad';
      ELSIF lower(COALESCE(v_props->>'origem_do_lead', '')) LIKE '%site%' OR
            lower(COALESCE(v_props->>'origem_do_lead', '')) LIKE '%website%' OR
            lower(COALESCE(v_props->>'hs_analytics_source', '')) IN ('organic_search', 'direct_traffic', 'referrals') OR
            lower(COALESCE(v_props->>'first_conversion_event_name', '')) LIKE '%expdentalsolutions.com%' OR
            lower(COALESCE(v_props->>'first_conversion_event_name', '')) LIKE '%register%' OR
            lower(COALESCE(v_props->>'first_conversion_event_name', '')) LIKE '%contact%' THEN
        v_source := 'form';
        v_source_detail := 'website';
      ELSE
        v_source := 'hubspot';
        v_source_detail := 'hubspot_reconcile';
      END IF;

      v_is_form_submission := (v_source = 'form' OR v_source = 'meta' OR v_course_interest_val IS NOT NULL);

      -- Pipeline stage resolution from qualification status
      v_qual_status := COALESCE(v_props->>'status_de_qualificacao', v_props->>'hs_lead_status');
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

      -- Deduplication Priority
      v_matched_lead_id := NULL;

      -- 1. Integration entity links (hubspot contact_id)
      SELECT eds_entity_id INTO v_matched_lead_id
      FROM public.integration_entity_links
      WHERE integration = 'hubspot'
        AND entity_type = 'lead'
        AND external_entity_id = v_contact_id
        AND status = 'active'
      LIMIT 1;

      -- 2. Leads table hubspot_contact_id
      IF v_matched_lead_id IS NULL THEN
        SELECT id INTO v_matched_lead_id
        FROM public.leads
        WHERE hubspot_contact_id = v_contact_id
          AND deleted_at IS NULL
        LIMIT 1;
      END IF;

      -- 3. Unique email match
      IF v_matched_lead_id IS NULL AND v_email IS NOT NULL THEN
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

      -- 4. Unique phone match
      IF v_matched_lead_id IS NULL AND v_phone IS NOT NULL AND length(v_phone) >= 8 THEN
        SELECT array_agg(id) INTO v_lead_matches
        FROM public.leads
        WHERE (regexp_replace(COALESCE(phone_raw, phone_e164, ''), '\D', '', 'g') = v_phone
           OR regexp_replace(COALESCE(phone_raw, phone_e164, ''), '\D', '', 'g') LIKE '%' || substring(v_phone from length(v_phone) - 7))
          AND deleted_at IS NULL;

        IF cardinality(v_lead_matches) = 1 THEN
          v_matched_lead_id := v_lead_matches[1];
        ELSIF cardinality(v_lead_matches) > 1 THEN
          INSERT INTO public.integration_conflicts (
            integration, entity_type, external_entity_id, conflict_type,
            conflict_summary, field_name, hubspot_data
          ) VALUES (
            'hubspot', 'lead', v_contact_id, 'MULTIPLE_PHONE_MATCH',
            'Phone ' || v_phone || ' matches ' || cardinality(v_lead_matches)::text || ' leads in EDS HUB',
            'phone', v_props
          );
          v_conflict_count := v_conflict_count + 1;
          CONTINUE;
        END IF;
      END IF;

      -- A. UPDATE EXISTING LEAD
      IF v_matched_lead_id IS NOT NULL THEN
        v_is_update := true;

        SELECT course_interest, course_interests
        INTO v_existing_course_interest, v_existing_course_interests
        FROM public.leads
        WHERE id = v_matched_lead_id;

        v_merged_course_interests := COALESCE(v_existing_course_interests, '[]'::jsonb);
        v_merged_course_interest := v_existing_course_interest;

        IF v_course_interest_val IS NOT NULL THEN
          IF NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(v_merged_course_interests) AS elem
            WHERE lower(trim(elem)) = lower(v_course_interest_val)
               OR (lower(v_course_interest_val) = 'zygomatic' AND lower(trim(elem)) LIKE '%zygoma%')
               OR (lower(v_course_interest_val) LIKE '%zygoma%' AND lower(trim(elem)) = 'zygomatic')
               OR (lower(v_course_interest_val) = 'wisdom' AND lower(trim(elem)) LIKE '%wisdom%')
               OR (lower(v_course_interest_val) LIKE '%wisdom%' AND lower(trim(elem)) = 'wisdom')
               OR (lower(v_course_interest_val) = 'endodontics' AND lower(trim(elem)) LIKE '%endo%')
               OR (lower(v_course_interest_val) LIKE '%endo%' AND lower(trim(elem)) = 'endodontics')
               OR (lower(v_course_interest_val) = 'periodontal plastic' AND lower(trim(elem)) LIKE '%perio%')
               OR (lower(v_course_interest_val) LIKE '%perio%' AND lower(trim(elem)) = 'periodontal plastic')
               OR (lower(v_course_interest_val) = 'rehabilitation' AND lower(trim(elem)) LIKE '%rehab%')
               OR (lower(v_course_interest_val) LIKE '%rehab%' AND lower(trim(elem)) = 'rehabilitation')
          ) THEN
            v_merged_course_interests := v_merged_course_interests || jsonb_build_array(v_course_interest_val);
            IF v_merged_course_interest IS NULL OR trim(v_merged_course_interest) = '' THEN
              v_merged_course_interest := v_course_interest_val;
            ELSE
              v_merged_course_interest := v_merged_course_interest || ', ' || v_course_interest_val;
            END IF;
          END IF;
        END IF;

        UPDATE public.leads
        SET
          first_name = COALESCE(v_first_name, first_name),
          last_name = COALESCE(v_last_name, last_name),
          email = COALESCE(v_email, email),
          phone_raw = COALESCE(v_phone, phone_raw),
          contact_preference = COALESCE(v_contact_pref, contact_preference),
          course_interest = COALESCE(v_merged_course_interest, course_interest),
          course_interests = v_merged_course_interests,
          hubspot_contact_id = v_contact_id,
          last_inbound_activity_at = CASE WHEN v_is_form_submission THEN now() ELSE last_inbound_activity_at END,
          has_new_submission = CASE WHEN v_is_form_submission THEN true ELSE has_new_submission END,
          new_submission_at = CASE WHEN v_is_form_submission THEN now() ELSE new_submission_at END,
          updated_at = now()
        WHERE id = v_matched_lead_id;

        -- Upsert active entity link
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

        v_updated_count := v_updated_count + 1;

      -- B. CREATE NEW LEAD
      ELSE
        v_is_update := false;
        INSERT INTO public.leads (
          first_name, last_name, email, phone_raw, contact_preference,
          course_interest, course_interests,
          source, source_detail, pipeline_stage_id, hubspot_contact_id,
          last_inbound_activity_at, has_new_submission, new_submission_at,
          source_created_at, created_at, updated_at
        ) VALUES (
          v_first_name, v_last_name, v_email, v_phone, v_contact_pref,
          v_course_interest_val,
          CASE WHEN v_course_interest_val IS NOT NULL 
               THEN jsonb_build_array(v_course_interest_val) 
               ELSE '[]'::jsonb END,
          v_source, v_source_detail,
          v_target_stage_id,
          v_contact_id,
          v_event_ts,
          false, NULL,
          v_source_created_at, v_source_created_at, now()
        ) RETURNING id INTO v_matched_lead_id;

        -- Create active entity link
        INSERT INTO public.integration_entity_links (
          integration, entity_type, eds_entity_id, external_entity_id,
          status, last_synced_hash, external_updated_at, last_inbound_sync_at
        ) VALUES (
          'hubspot', 'lead', v_matched_lead_id, v_contact_id,
          'active', v_payload_hash, v_event_ts, now()
        );

        -- Activity: lead_created
        INSERT INTO public.lead_activities (
          lead_id, activity_type, actor_type, summary, metadata
        ) VALUES (
          v_matched_lead_id, 'lead_created', 'system',
          'Lead imported via HubSpot sync (' || v_source_detail || ')', 
          jsonb_build_object('external_id', v_contact_id, 'source', v_source, 'source_detail', v_source_detail, 'course', v_course_interest_val)
        );

        v_created_count := v_created_count + 1;
      END IF;

      -- Relational Course Linking in lead_course_interests
      IF v_resolved_course_id IS NOT NULL THEN
        INSERT INTO public.lead_course_interests (lead_id, course_id, source, status)
        VALUES (v_matched_lead_id, v_resolved_course_id, 'hubspot_sync', 'active')
        ON CONFLICT DO NOTHING;
      ELSIF v_course_interest_val IS NOT NULL THEN
        -- Log unmapped course for follow-up without dropping lead
        INSERT INTO public.integration_conflicts (
          integration, entity_type, eds_entity_id, external_entity_id,
          conflict_type, conflict_summary, field_name, hubspot_data
        ) VALUES (
          'hubspot', 'lead', v_matched_lead_id, v_contact_id,
          'MAPPING_VALUE_UNKNOWN',
          'Unmapped course interest: ' || v_course_interest_val,
          'course_interest', jsonb_build_object('raw_value', v_course_interest_val)
        ) ON CONFLICT DO NOTHING;
      END IF;

      -- Store form_submissions record for traceability
      IF v_is_form_submission THEN
        INSERT INTO public.form_submissions (
          lead_id,
          form_name,
          source,
          submitted_at,
          submitted_data,
          email,
          phone_e164,
          contact_preference,
          course_interest,
          source_detail,
          processing_status,
          recovery_state,
          idempotency_key
        ) VALUES (
          v_matched_lead_id,
          COALESCE(v_props->>'first_conversion_event_name', v_props->>'form_name', v_course_interest_val, 'Formulário HubSpot'),
          CASE 
            WHEN lower(COALESCE(v_props->>'origem_do_lead', '')) LIKE '%instagram%' THEN 'Instagram Lead Ads'
            WHEN lower(COALESCE(v_props->>'origem_do_lead', '')) LIKE '%facebook%' THEN 'Facebook Lead Ads'
            WHEN v_source = 'form' THEN 'Site'
            ELSE 'Meta Lead Ads'
          END,
          COALESCE(v_event_ts, now()),
          v_props,
          v_email,
          v_phone,
          v_contact_pref,
          v_course_interest_val,
          v_source_detail,
          'processed',
          'complete',
          'hubspot_form_sub:' || v_contact_id || ':' || md5(COALESCE(v_props->>'first_conversion_event_name', v_props->>'recent_conversion_event_name', v_course_interest_val, 'sub'))
        ) ON CONFLICT (idempotency_key) DO NOTHING;
      END IF;

      -- Observability: Log event into public.integration_sync_events
      INSERT INTO public.integration_sync_events (
        integration, direction, entity_type, eds_entity_id, external_entity_id,
        event_type, external_event_id, external_event_timestamp, payload_hash,
        status, attempt_count, error_code, error_message, change_summary,
        created_at, processed_at
      ) VALUES (
        'hubspot', 'inbound', 'lead', v_matched_lead_id, v_contact_id,
        CASE WHEN v_is_update THEN 'contact.propertyChange' ELSE 'contact.creation' END,
        COALESCE(v_event_id, 'reconcile:' || v_contact_id || ':' || extract(epoch from v_event_ts)::text),
        v_event_ts, v_payload_hash,
        'completed', 1, NULL, NULL,
        jsonb_build_object(
          'action', CASE WHEN v_is_update THEN 'updated' ELSE 'created' END,
          'source', v_source,
          'source_detail', v_source_detail,
          'course', v_course_interest_val,
          'contact_preference', v_contact_pref
        ),
        now(), now()
      ) ON CONFLICT (integration, external_event_id) WHERE external_event_id IS NOT NULL
      DO UPDATE SET
        eds_entity_id = EXCLUDED.eds_entity_id,
        status = 'completed',
        attempt_count = public.integration_sync_events.attempt_count + 1,
        change_summary = EXCLUDED.change_summary,
        processed_at = now();

    EXCEPTION WHEN OTHERS THEN
      -- Record failure to integration_sync_events for observability
      INSERT INTO public.integration_sync_events (
        integration, direction, entity_type, external_entity_id,
        event_type, external_event_id, external_event_timestamp, payload_hash,
        status, attempt_count, error_code, error_message, change_summary,
        created_at, processed_at
      ) VALUES (
        'hubspot', 'inbound', 'lead', v_contact_id,
        'hubspot_error',
        'error:' || COALESCE(v_contact_id, 'unknown') || ':' || extract(epoch from now())::text,
        v_event_ts, COALESCE(v_payload_hash, 'none'),
        'failed', 1, SQLSTATE, SQLERRM,
        jsonb_build_object('event', v_event),
        now(), now()
      ) ON CONFLICT DO NOTHING;

      v_ignored_count := v_ignored_count + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'processed_count', v_created_count + v_updated_count,
    'created_count', v_created_count,
    'updated_count', v_updated_count,
    'ignored_count', v_ignored_count,
    'conflict_count', v_conflict_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_hubspot_inbound_batch TO service_role;
GRANT EXECUTE ON FUNCTION public.process_hubspot_inbound_batch TO authenticated;

-- Update trigger_hubspot_reconcile with dual headers and 30-day lookback
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
      'x-admin-key', 'eds_internal_course_materials_mgmt_2026',
      'Authorization', 'Bearer eds_internal_course_materials_mgmt_2026'
    ),
    body := jsonb_build_object(
      'lookback_days', 30,
      'batch_size', 100
    )
  );
END;
$$;
