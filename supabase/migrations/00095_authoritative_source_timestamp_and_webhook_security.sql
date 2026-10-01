-- =============================================================================
-- Migration 00095: Authoritative Source Timestamp & Webhook Security Preservation
-- =============================================================================
-- 1. Updates process_hubspot_inbound_batch RPC:
--    - Strictly derives source_created_at from HubSpot contact 'createdate'.
--    - If 'createdate' is missing, leaves source_created_at as NULL (never defaults to now() or event_ts).
--    - When creating a lead: records true source_created_at, with created_at as now() (local insertion time).
--    - In created_leads JSON: outputs both source_created_at and hubspot_contact_id.
-- 2. Updates public.trg_leads_canonical_creation:
--    - Prevents overwriting NULL source_created_at with now() for integrated leads (HubSpot/Meta).
--    - Preserves fail-safe behavior for leads with missing/unreliable source timestamps.
-- =============================================================================

-- 1. Update trg_leads_canonical_creation trigger function
CREATE OR REPLACE FUNCTION public.trg_leads_canonical_creation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only fallback to created_at if source_created_at is null AND lead origin is internal/manual/direct
  -- Never overwrite NULL source_created_at for imported/integrated leads (HubSpot/Meta)
  -- so that freshness decision audits can fail-safe when source timestamp is missing.
  IF NEW.source_created_at IS NULL AND (NEW.source IS NULL OR NEW.source = 'manual' OR NEW.source = 'direct') THEN
    NEW.source_created_at := COALESCE(NEW.created_at, now());
  END IF;
  RETURN NEW;
END;
$$;

-- 2. Update process_hubspot_inbound_batch RPC
CREATE OR REPLACE FUNCTION public.process_hubspot_inbound_batch(p_events JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_created_count INT := 0;
  v_updated_count INT := 0;
  v_ignored_count INT := 0;
  v_conflict_count INT := 0;
  v_created_leads JSONB := '[]'::jsonb;
  v_event JSONB;
  v_contact_id TEXT;
  v_event_id TEXT;
  v_event_ts TIMESTAMPTZ;
  v_props JSONB;
  v_email TEXT;
  v_email_confirmation TEXT;
  v_email_mismatch BOOLEAN := false;
  v_phone TEXT;
  v_first_name TEXT;
  v_last_name TEXT;
  v_course_interest_val TEXT;
  v_raw_course_interest TEXT;
  v_contact_pref TEXT;
  v_source TEXT;
  v_source_detail TEXT;
  v_qual_status TEXT;
  v_source_created_at TIMESTAMPTZ;
  v_target_stage_id UUID;
  v_capture_stage_id UUID;
  v_matched_lead_id UUID;
  v_lead_matches UUID[];
  v_payload_hash TEXT;
  v_is_update BOOLEAN;
  v_is_form_submission BOOLEAN;
  v_existing_course_interest TEXT;
  v_existing_course_interests JSONB;
  v_merged_course_interests JSONB;
  v_merged_course_interest TEXT;
  v_resolved_course_id UUID;
BEGIN
  -- Resolve default capture stage
  SELECT id INTO v_capture_stage_id
  FROM public.pipeline_stages
  WHERE code = 'capture'
  LIMIT 1;

  FOR v_event IN SELECT * FROM jsonb_array_elements(p_events) LOOP
    BEGIN
      -- Extract contact ID from hs_object_id, objectId, or id
      v_contact_id := NULLIF(trim(COALESCE(
        v_event->'properties'->>'hs_object_id',
        v_event->>'objectId',
        v_event->>'hs_object_id',
        v_event->>'id',
        ''
      )), '');

      IF v_contact_id IS NULL THEN
        v_ignored_count := v_ignored_count + 1;
        CONTINUE;
      END IF;

      v_event_id := NULLIF(trim(COALESCE(v_event->>'eventId', v_event->>'id', '')), '');
      
      -- Event timestamp
      IF v_event->>'occurredAt' IS NOT NULL THEN
        v_event_ts := to_timestamp((v_event->>'occurredAt')::double precision / 1000.0);
      ELSIF v_event->>'timestamp' IS NOT NULL THEN
        v_event_ts := (v_event->>'timestamp')::timestamptz;
      ELSE
        v_event_ts := now();
      END IF;

      -- Source created_at detection:
      -- Strictly parse HubSpot 'createdate'. If missing or unparseable, set to NULL (do not default to event_ts or now())
      v_props := COALESCE(v_event->'properties', '{}'::jsonb);
      IF v_props->>'createdate' IS NOT NULL THEN
        BEGIN
          IF v_props->>'createdate' ~ '^\d+$' THEN
            v_source_created_at := to_timestamp((v_props->>'createdate')::double precision / 1000.0);
          ELSE
            v_source_created_at := (v_props->>'createdate')::timestamptz;
          END IF;
        EXCEPTION WHEN OTHERS THEN
          v_source_created_at := NULL;
        END;
      ELSE
        v_source_created_at := NULL;
      END IF;

      -- Merge top-level fields into properties if not present
      IF v_event->>'email' IS NOT NULL AND v_props->>'email' IS NULL THEN
        v_props := v_props || jsonb_build_object('email', v_event->>'email');
      END IF;
      IF v_event->>'firstname' IS NOT NULL AND v_props->>'firstname' IS NULL THEN
        v_props := v_props || jsonb_build_object('firstname', v_event->>'firstname');
      END IF;
      IF v_event->>'lastname' IS NOT NULL AND v_props->>'lastname' IS NULL THEN
        v_props := v_props || jsonb_build_object('lastname', v_event->>'lastname');
      END IF;
      IF v_event->>'phone' IS NOT NULL AND v_props->>'phone' IS NULL THEN
        v_props := v_props || jsonb_build_object('phone', v_event->>'phone');
      END IF;

      -- Payload hash for change detection
      v_payload_hash := md5(v_props::text);

      -- Extract individual fields
      v_email := NULLIF(lower(trim(COALESCE(
        v_props->>'email',
        v_props->>'e-mail',
        ''
      ))), '');

      v_email_confirmation := NULLIF(lower(trim(COALESCE(
        v_props->>'email_confirmation',
        v_props->>'confirmacao_de_email',
        v_props->>'confirmacao_email',
        ''
      ))), '');

      IF v_email IS NOT NULL AND v_email_confirmation IS NOT NULL AND v_email <> v_email_confirmation THEN
        v_email_mismatch := true;
      ELSE
        v_email_mismatch := false;
      END IF;

      v_phone := NULLIF(trim(COALESCE(
        v_props->>'phone',
        v_props->>'mobilephone',
        v_props->>'hs_calculated_phone_number',
        v_props->>'whatsapp',
        v_props->>'telefone',
        v_props->>'celular',
        ''
      )), '');

      v_first_name := NULLIF(trim(COALESCE(
        v_props->>'firstname',
        v_props->>'first_name',
        v_props->>'nome',
        ''
      )), '');

      v_last_name := NULLIF(trim(COALESCE(
        v_props->>'lastname',
        v_props->>'last_name',
        v_props->>'sobrenome',
        ''
      )), '');

      -- Split full name if firstname contains both and lastname is empty
      IF v_first_name IS NOT NULL AND v_last_name IS NULL AND position(' ' in v_first_name) > 0 THEN
        v_last_name := substring(v_first_name from position(' ' in v_first_name) + 1);
        v_first_name := substring(v_first_name from 1 for position(' ' in v_first_name) - 1);
      END IF;

      -- Contact Preference
      v_contact_pref := NULLIF(lower(trim(COALESCE(
        v_props->>'contact_preference',
        v_props->>'preferencia_de_contato',
        v_props->>'preferred_contact_method',
        v_props->>'what_is_your_preferred_contact_method',
        v_props->>'what_is_your_preferred_method_of_contact',
        ''
      ))), '');

      IF v_contact_pref IS NOT NULL THEN
        IF v_contact_pref IN ('email', 'e-mail', 'mail') THEN
          v_contact_pref := 'email';
        ELSIF v_contact_pref IN ('sms', 'text', 'torpedo') OR v_contact_pref LIKE '%sms%' THEN
          v_contact_pref := 'sms';
        ELSIF v_contact_pref IN ('whatsapp', 'whats', 'zap', 'wa') OR v_contact_pref LIKE '%whats%' OR v_contact_pref LIKE '%zap%' THEN
          v_contact_pref := 'whatsapp';
        ELSIF v_contact_pref IN ('phone', 'call', 'ligacao', 'telefone') OR v_contact_pref LIKE '%phone%' OR v_contact_pref LIKE '%call%' OR v_contact_pref LIKE '%lig%' THEN
          v_contact_pref := 'call';
        ELSE
          v_contact_pref := NULL;
        END IF;
      END IF;

      -- Course Interest extraction & normalization
      v_raw_course_interest := NULLIF(trim(COALESCE(
        v_props->>'course_interest',
        v_props->>'curso_de_interesse',
        v_props->>'curso_de_interesse_2',
        v_props->>'curso_de_interesse_3',
        v_props->>'data_do_curso_de_interesse',
        v_props->>'recent_conversion_event_name',
        v_props->>'first_conversion_event_name',
        ''
      )), '');

      v_course_interest_val := NULL;
      v_resolved_course_id := NULL;

      IF v_raw_course_interest IS NOT NULL THEN
        IF lower(v_raw_course_interest) LIKE '%zygo%' OR lower(v_raw_course_interest) LIKE '%zigom%' THEN
          v_course_interest_val := 'Zygomatic';
        ELSIF lower(v_raw_course_interest) LIKE '%wisdom%' OR lower(v_raw_course_interest) LIKE '%siso%' THEN
          v_course_interest_val := 'Wisdom Teeth';
        ELSIF lower(v_raw_course_interest) LIKE '%all-on-4%' OR lower(v_raw_course_interest) LIKE '%all on 4%' OR lower(v_raw_course_interest) LIKE '%allon4%' THEN
          v_course_interest_val := 'All-on-4';
        ELSIF lower(v_raw_course_interest) LIKE '%implant%' OR lower(v_raw_course_interest) LIKE '%implante%' THEN
          v_course_interest_val := 'Dental Implants';
        ELSIF lower(v_raw_course_interest) LIKE '%bone graft%' OR lower(v_raw_course_interest) LIKE '%enxerto%' THEN
          v_course_interest_val := 'Bone Grafting';
        ELSIF lower(v_raw_course_interest) LIKE '%sinus%' OR lower(v_raw_course_interest) LIKE '%levantamento de seio%' THEN
          v_course_interest_val := 'Sinus Lift';
        ELSIF lower(v_raw_course_interest) LIKE '%perio%' OR lower(v_raw_course_interest) LIKE '%gengiv%' THEN
          v_course_interest_val := 'Periodontics';
        ELSE
          v_course_interest_val := v_raw_course_interest;
        END IF;

        -- Safe relational lookup
        SELECT id INTO v_resolved_course_id
        FROM public.courses
        WHERE is_active = true
          AND (
            lower(title) = lower(v_course_interest_val)
            OR lower(code) = lower(v_course_interest_val)
            OR (lower(v_course_interest_val) = 'zygomatic' AND (lower(title) LIKE '%zygo%' OR lower(code) LIKE '%zygo%'))
            OR (lower(v_course_interest_val) = 'wisdom teeth' AND (lower(title) LIKE '%wisdom%' OR lower(code) LIKE '%wisdom%'))
          )
        ORDER BY created_at ASC
        LIMIT 1;
      END IF;

      -- Source attribution
      IF lower(COALESCE(v_props->>'origem_do_lead', v_props->>'lead_source', v_props->>'hs_analytics_source', '')) LIKE '%meta%'
         OR lower(COALESCE(v_props->>'origem_do_lead', v_props->>'lead_source', '')) LIKE '%facebook%'
         OR lower(COALESCE(v_props->>'origem_do_lead', v_props->>'lead_source', '')) LIKE '%instagram%'
         OR v_props->>'first_conversion_event_name' LIKE '%Lead Ad%'
         OR v_props->>'recent_conversion_event_name' LIKE '%Lead Ad%' THEN
        v_source := 'meta';
        IF lower(COALESCE(v_props->>'origem_do_lead', '')) LIKE '%instagram%' THEN
          v_source_detail := 'instagram';
        ELSIF lower(COALESCE(v_props->>'origem_do_lead', '')) LIKE '%facebook%' THEN
          v_source_detail := 'facebook';
        ELSE
          v_source_detail := 'meta_lead_ad';
        END IF;
      ELSIF lower(COALESCE(v_props->>'hs_analytics_source', '')) LIKE '%organic%' THEN
        v_source := 'form';
        v_source_detail := 'organic_search';
      ELSIF lower(COALESCE(v_props->>'hs_analytics_source', '')) LIKE '%direct%' THEN
        v_source := 'form';
        v_source_detail := 'direct_traffic';
      ELSE
        v_source := 'hubspot';
        v_source_detail := COALESCE(v_props->>'origem_do_lead', v_props->>'lead_source', 'hubspot_sync');
      END IF;

      -- Check if form submission
      v_is_form_submission := (
        v_props->>'first_conversion_event_name' IS NOT NULL
        OR v_props->>'recent_conversion_event_name' IS NOT NULL
        OR v_props->>'origem_do_lead' IS NOT NULL
      );

      -- Qualification status
      v_qual_status := lower(COALESCE(v_props->>'status_de_qualificacao', v_props->>'hs_lead_status', ''));

      -- Map target stage
      IF v_qual_status IN ('qualified', 'qualificado', 'alta_prioridade', 'qualificacao_concluida') THEN
        SELECT id INTO v_target_stage_id FROM public.pipeline_stages WHERE code = 'qualification' LIMIT 1;
      ELSIF v_qual_status IN ('unqualified', 'desqualificado', 'spam') THEN
        SELECT id INTO v_target_stage_id FROM public.pipeline_stages WHERE code = 'lost' LIMIT 1;
      ELSIF v_qual_status IN ('connected', 'contacted', 'em_contato', 'respondido', 'contact_made') THEN
        SELECT id INTO v_target_stage_id FROM public.pipeline_stages WHERE code = 'contact_made' LIMIT 1;
      ELSE
        v_target_stage_id := v_capture_stage_id;
      END IF;

      IF v_target_stage_id IS NULL THEN
        v_target_stage_id := v_capture_stage_id;
      END IF;

      -- Deduplication & Lead Matching:
      v_matched_lead_id := NULL;

      -- 1. Integration entity links lookup
      SELECT eds_entity_id INTO v_matched_lead_id
      FROM public.integration_entity_links
      WHERE integration = 'hubspot'
        AND entity_type = 'lead'
        AND external_entity_id = v_contact_id
      LIMIT 1;

      -- 2. Direct hubspot_contact_id lookup on leads table
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

      -- A. UPDATE EXISTING LEAD (Preserves created_at, stage, and resurfaces via last_inbound_activity_at)
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
          ) THEN
            v_merged_course_interests := v_merged_course_interests || jsonb_build_array(v_course_interest_val);
          END IF;
          IF v_merged_course_interest IS NULL OR trim(v_merged_course_interest) = '' THEN
            v_merged_course_interest := v_course_interest_val;
          END IF;
        END IF;

        UPDATE public.leads
        SET
          first_name = COALESCE(v_first_name, first_name),
          last_name = COALESCE(v_last_name, last_name),
          phone_raw = COALESCE(v_phone, phone_raw),
          email_confirmation = COALESCE(v_email_confirmation, email_confirmation),
          email_mismatch = (v_email_mismatch OR email_mismatch),
          contact_preference = COALESCE(v_contact_pref, contact_preference),
          course_interest = v_merged_course_interest,
          course_interests = v_merged_course_interests,
          hubspot_contact_id = COALESCE(hubspot_contact_id, v_contact_id),
          last_inbound_activity_at = v_event_ts,
          has_new_submission = true,
          new_submission_at = v_event_ts,
          updated_at = now()
        WHERE id = v_matched_lead_id;

        -- Update integration entity link
        INSERT INTO public.integration_entity_links (
          integration, entity_type, eds_entity_id, external_entity_id,
          status, last_synced_hash, external_updated_at, last_inbound_sync_at
        ) VALUES (
          'hubspot', 'lead', v_matched_lead_id, v_contact_id,
          'active', v_payload_hash, v_event_ts, now()
        ) ON CONFLICT (integration, entity_type, external_entity_id)
        DO UPDATE SET
          last_synced_hash = EXCLUDED.last_synced_hash,
          external_updated_at = EXCLUDED.external_updated_at,
          last_inbound_sync_at = now(),
          updated_at = now();

        v_updated_count := v_updated_count + 1;

      -- B. CREATE NEW LEAD
      ELSE
        v_is_update := false;
        INSERT INTO public.leads (
          first_name, last_name, email, email_confirmation, email_mismatch, phone_raw, contact_preference,
          course_interest, course_interests,
          source, source_detail, pipeline_stage_id, hubspot_contact_id,
          last_inbound_activity_at, has_new_submission, new_submission_at,
          source_created_at, created_at, updated_at
        ) VALUES (
          v_first_name, v_last_name, v_email, COALESCE(v_email_confirmation, v_email), v_email_mismatch, v_phone, v_contact_pref,
          v_course_interest_val,
          CASE WHEN v_course_interest_val IS NOT NULL 
               THEN jsonb_build_array(v_course_interest_val) 
               ELSE '[]'::jsonb END,
          v_source, v_source_detail,
          v_target_stage_id,
          v_contact_id,
          v_event_ts,
          false, NULL,
          v_source_created_at, now(), now()
        ) RETURNING id INTO v_matched_lead_id;

        -- Upsert active entity link
        INSERT INTO public.integration_entity_links (
          integration, entity_type, eds_entity_id, external_entity_id,
          status, last_synced_hash, external_updated_at, last_inbound_sync_at
        ) VALUES (
          'hubspot', 'lead', v_matched_lead_id, v_contact_id,
          'active', v_payload_hash, v_event_ts, now()
        );

        -- Stage history log
        INSERT INTO public.lead_stage_history (
          lead_id, from_stage_id, to_stage_id, change_reason
        ) VALUES (
          v_matched_lead_id, NULL, v_target_stage_id, 'initial_assignment'
        );

        -- Activity: lead_created
        INSERT INTO public.lead_activities (
          lead_id, activity_type, actor_type, summary, metadata
        ) VALUES (
          v_matched_lead_id, 'lead_created', 'system',
          'Lead synchronized from HubSpot: ' || COALESCE(v_first_name || ' ' || COALESCE(v_last_name, ''), v_email, v_contact_id),
          jsonb_build_object(
            'source', v_source,
            'source_detail', v_source_detail,
            'hubspot_contact_id', v_contact_id,
            'course', v_course_interest_val,
            'source_created_at', v_source_created_at
          )
        );

        -- Accumulate created lead for real-time automation handoff
        v_created_leads := v_created_leads || jsonb_build_array(jsonb_build_object(
          'lead_id', v_matched_lead_id,
          'hubspot_contact_id', v_contact_id,
          'email', v_email,
          'email_confirmation', v_email_confirmation,
          'phone', v_phone,
          'first_name', v_first_name,
          'last_name', v_last_name,
          'contact_preference', v_contact_pref,
          'course_interest', v_course_interest_val,
          'source', v_source,
          'source_detail', v_source_detail,
          'source_created_at', v_source_created_at,
          'created_at', now()
        ));

        v_created_count := v_created_count + 1;
      END IF;

      -- Relational Course Interest linking (safely wrapped)
      IF v_resolved_course_id IS NOT NULL THEN
        BEGIN
          INSERT INTO public.lead_course_interests (
            lead_id, course_id, priority, source, status, created_at, updated_at
          ) VALUES (
            v_matched_lead_id, v_resolved_course_id, 1, 'hubspot_sync', 'active', now(), now()
          ) ON CONFLICT (lead_id, course_id) DO NOTHING;
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'Course interest link warning: %', SQLERRM;
        END;
      ELSIF v_course_interest_val IS NOT NULL THEN
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
          email_confirmation,
          email_mismatch,
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
          v_props || jsonb_build_object(
            'email_confirmation', COALESCE(v_email_confirmation, v_email),
            'email_mismatch', v_email_mismatch
          ),
          v_email,
          v_email_confirmation,
          v_email_mismatch,
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
    'conflict_count', v_conflict_count,
    'created_leads', v_created_leads
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_hubspot_inbound_batch TO service_role;
GRANT EXECUTE ON FUNCTION public.process_hubspot_inbound_batch TO authenticated;
