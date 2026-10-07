-- Migration 00111: Guarantee Returning Lead Course Interest Accumulation Across Inbound Pipelines
--
-- 1. Updates process_hubspot_inbound_batch RPC:
--    - For returning leads:
--      * Accumulates course_interests JSONB array without losing previous courses
--      * Accumulates comma-separated course_interest string without overwriting
--      * Relational insertion into lead_course_interests with next available priority slot (1..3)
--      * Protects against duplicate (lead_id, course_id) or colliding priorities
--    - For new leads:
--      * Resolves course_id from public.courses and links into lead_course_interests with source 'hubspot'
-- 2. Data repair for Rohan Sharma:
--    - Ensures both 'Advanced Dental Implant Experience' and 'Wisdom Teeth Training' are stored
--    - Ensures relational lead_course_interests has active rows for both courses

CREATE OR REPLACE FUNCTION public.process_hubspot_inbound_batch(
  p_events JSONB,
  p_connection_id UUID DEFAULT NULL
)
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
  v_source_created_at TIMESTAMPTZ;
  v_authoritative_ts TIMESTAMPTZ;
  v_props JSONB;
  v_email_resolution JSONB;
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
  v_capture_stage_id UUID;
  v_matched_lead_id UUID;
  v_payload_hash TEXT;
  v_first_conv TEXT;
  v_recent_conv TEXT;
  v_analytics_data_1 TEXT;
  v_origem TEXT;
  v_existing_lead_course TEXT;
  v_existing_course_interests JSONB;
  v_merged_course_interests JSONB;
  v_merged_course_interest TEXT;
  v_resolved_course_id UUID;
  v_slot SMALLINT;
  v_intent TEXT;
  v_is_course_info BOOLEAN;
  v_activity_summary TEXT;
  v_existing_active_link RECORD;
BEGIN
  -- Resolve default capture stage (Novo Lead)
  SELECT id INTO v_capture_stage_id
  FROM public.pipeline_stages
  WHERE code = 'capture'
  LIMIT 1;

  FOR v_event IN SELECT * FROM jsonb_array_elements(p_events) LOOP
    BEGIN
      -- 1. Contact Identification
      v_contact_id := NULLIF(trim(COALESCE(
        v_event->'properties'->>'hs_object_id',
        v_event->>'objectId',
        v_event->>'hs_object_id',
        v_event->>'id',
        v_event->>'contact_id',
        ''
      )), '');

      IF v_contact_id IS NULL THEN
        v_ignored_count := v_ignored_count + 1;
        CONTINUE;
      END IF;

      -- 2. Extract Event Metadata & Properties
      v_event_id := COALESCE(v_event->>'eventId', v_event->>'id', gen_random_uuid()::text);
      v_props := COALESCE(v_event->'properties', v_event);

      -- 3. Extract and resolve Authoritative Timestamps
      v_event_ts := NULL;
      IF v_event->>'occurredAt' IS NOT NULL THEN
        BEGIN
          v_event_ts := to_timestamp((v_event->>'occurredAt')::double precision / 1000.0);
        EXCEPTION WHEN OTHERS THEN
          v_event_ts := NULL;
        END;
      END IF;

      IF v_event_ts IS NULL AND v_props->>'lastmodifieddate' IS NOT NULL THEN
        BEGIN
          IF v_props->>'lastmodifieddate' ~ '^\d+$' THEN
            v_event_ts := to_timestamp((v_props->>'lastmodifieddate')::double precision / 1000.0);
          ELSE
            v_event_ts := (v_props->>'lastmodifieddate')::timestamptz;
          END IF;
        EXCEPTION WHEN OTHERS THEN
          v_event_ts := NULL;
        END;
      END IF;

      v_source_created_at := NULL;
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
      END IF;

      v_authoritative_ts := COALESCE(v_event_ts, v_source_created_at, now());

      -- 4. Multi-email canonical resolution
      v_email_resolution := public.resolve_hubspot_contact_emails(v_props);
      v_email := v_email_resolution->>'primary_email';
      v_email_confirmation := v_email_resolution->>'confirmation_email';
      v_email_mismatch := (v_email_resolution->>'email_mismatch')::boolean;

      -- 5. Name and Phone Normalization
      v_first_name := NULLIF(trim(COALESCE(v_props->>'firstname', '')), '');
      v_last_name := NULLIF(trim(COALESCE(v_props->>'lastname', '')), '');
      v_phone := NULLIF(regexp_replace(COALESCE(v_props->>'phone', v_props->>'mobilephone', ''), '\D', '', 'g'), '');
      IF v_phone = '' THEN
        v_phone := NULL;
      END IF;

      -- 6. Contact preference detection
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

      -- Course Interest Mapping
      v_raw_course_interest := NULLIF(trim(COALESCE(
        v_props->>'course_interest',
        v_props->>'qual_curso_voce_tem_interesse_',
        v_props->>'qual_curso_tem_interesse',
        v_props->>'curso_de_interesse',
        v_props->>'qual_e_o_curso_do_seu_interesse_',
        v_props->>'course',
        v_event->>'course_interest',
        v_event->>'course',
        ''
      )), '');

      IF v_raw_course_interest IS NULL OR trim(v_raw_course_interest) = '' THEN
        IF lower(COALESCE(v_props->>'first_conversion_event_name', v_props->>'recent_conversion_event_name', v_props->>'form_name', '')) LIKE '%zygo%' THEN
          v_raw_course_interest := 'Zygomatic';
        ELSIF lower(COALESCE(v_props->>'first_conversion_event_name', v_props->>'recent_conversion_event_name', v_props->>'form_name', '')) LIKE '%wisdom%' OR
              lower(COALESCE(v_props->>'first_conversion_event_name', v_props->>'recent_conversion_event_name', v_props->>'form_name', '')) LIKE '%molar%' THEN
          v_raw_course_interest := 'Wisdom';
        ELSIF lower(COALESCE(v_props->>'first_conversion_event_name', v_props->>'recent_conversion_event_name', v_props->>'form_name', '')) LIKE '%endo%' THEN
          v_raw_course_interest := 'Endodontic';
        ELSIF lower(COALESCE(v_props->>'first_conversion_event_name', v_props->>'recent_conversion_event_name', v_props->>'form_name', '')) LIKE '%perio%' THEN
          v_raw_course_interest := 'Periodontal';
        ELSIF lower(COALESCE(v_props->>'first_conversion_event_name', v_props->>'recent_conversion_event_name', v_props->>'form_name', '')) LIKE '%rehab%' OR
              lower(COALESCE(v_props->>'first_conversion_event_name', v_props->>'recent_conversion_event_name', v_props->>'form_name', '')) LIKE '%reabilit%' THEN
          v_raw_course_interest := 'Rehabilitation';
        ELSIF lower(COALESCE(v_props->>'first_conversion_event_name', v_props->>'recent_conversion_event_name', v_props->>'form_name', '')) LIKE '%intensiv%' THEN
          v_raw_course_interest := 'Intensive Dental Implant Training';
        ELSIF lower(COALESCE(v_props->>'first_conversion_event_name', v_props->>'recent_conversion_event_name', v_props->>'form_name', '')) LIKE '%advanced%' THEN
          v_raw_course_interest := 'Advanced Dental Implant Experience';
        END IF;
      END IF;

      v_course_interest_val := NULL;
      IF v_raw_course_interest IS NOT NULL THEN
        IF lower(v_raw_course_interest) LIKE '%zygo%' THEN
          v_course_interest_val := 'Zygomatic';
        ELSIF lower(v_raw_course_interest) LIKE '%wisdom%' OR lower(v_raw_course_interest) LIKE '%molar%' THEN
          v_course_interest_val := 'Wisdom';
        ELSIF lower(v_raw_course_interest) LIKE '%endo%' THEN
          v_course_interest_val := 'Endodontic';
        ELSIF lower(v_raw_course_interest) LIKE '%perio%' THEN
          v_course_interest_val := 'Periodontal';
        ELSIF lower(v_raw_course_interest) LIKE '%rehab%' THEN
          v_course_interest_val := 'Rehabilitation';
        ELSIF lower(v_raw_course_interest) LIKE '%intensiv%' THEN
          v_course_interest_val := 'Intensive Dental Implant Training';
        ELSIF lower(v_raw_course_interest) LIKE '%advanced%' THEN
          v_course_interest_val := 'Advanced Dental Implant Experience';
        ELSIF lower(v_raw_course_interest) LIKE '%implant%' THEN
          v_course_interest_val := 'Implant';
        ELSE
          v_course_interest_val := v_raw_course_interest;
        END IF;
      END IF;

      -- 7. Factual Acquisition Source Attribution & Intent
      v_first_conv := lower(COALESCE(v_props->>'first_conversion_event_name', ''));
      v_recent_conv := lower(COALESCE(v_props->>'recent_conversion_event_name', ''));
      v_analytics_data_1 := lower(COALESCE(v_props->>'hs_analytics_source_data_1', ''));
      v_origem := lower(COALESCE(v_props->>'origem_do_lead', v_props->>'lead_source', ''));

      v_is_course_info := (
        v_first_conv LIKE '%#course-info-form%' OR v_recent_conv LIKE '%#course-info-form%'
        OR v_first_conv LIKE '%course information%' OR v_recent_conv LIKE '%course information%'
      );

      IF v_is_course_info OR v_first_conv LIKE '%contact%' OR v_recent_conv LIKE '%contact%' OR v_analytics_data_1 LIKE '%contact%' THEN
        v_source := 'website';
        v_source_detail := 'contact_form';
        v_intent := 'COURSE_INFORMATION_REQUEST';
        v_activity_summary := 'Solicitou informações sobre ' || COALESCE(v_course_interest_val, 'Curso');
      ELSIF v_first_conv LIKE '%register%' OR v_recent_conv LIKE '%register%' OR v_analytics_data_1 LIKE '%register%' THEN
        v_source := 'website';
        v_source_detail := 'website_registration_form';
        v_intent := 'COMPLETED_ENROLLMENT';
        v_activity_summary := 'Inscrição via site: ' || COALESCE(v_course_interest_val, 'Curso');
      ELSIF v_origem LIKE '%meta%' OR v_origem LIKE '%facebook%' OR v_origem LIKE '%instagram%' OR
            v_first_conv LIKE '%lead ad%' OR v_first_conv LIKE '%facebook%' OR v_recent_conv LIKE '%lead ad%' OR
            lower(COALESCE(v_props->>'hs_analytics_source', '')) = 'paid_social' THEN
        v_source := 'meta';
        IF v_origem LIKE '%instagram%' THEN
          v_source_detail := 'instagram';
        ELSIF v_origem LIKE '%facebook%' THEN
          v_source_detail := 'facebook';
        ELSE
          v_source_detail := 'meta_lead_ad';
        END IF;
        v_intent := 'META_LEAD_AD';
        v_activity_summary := 'Lead sincronizado via Meta Lead Ads: ' || COALESCE(v_course_interest_val, 'Curso');
      ELSIF v_origem LIKE '%site%' OR v_origem LIKE '%website%' OR
            lower(COALESCE(v_props->>'hs_analytics_source', '')) IN ('organic_search', 'direct_traffic', 'referrals') THEN
        v_source := 'website';
        v_source_detail := 'website';
        v_intent := 'WEBSITE_ORGANIC';
        v_activity_summary := 'Lead originado no site: ' || COALESCE(v_course_interest_val, 'Curso');
      ELSE
        v_source := 'hubspot';
        v_source_detail := COALESCE(v_props->>'hs_analytics_source', 'hubspot_sync');
        v_intent := 'HUBSPOT_SYNC';
        v_activity_summary := 'Lead sincronizado do HubSpot: ' || COALESCE(v_course_interest_val, 'Curso');
      END IF;

      -- 8. Deduplication & Canonical Lead Resolution
      v_matched_lead_id := NULL;

      -- 8a. Match by active integration_entity_link
      SELECT eds_entity_id INTO v_matched_lead_id
      FROM public.integration_entity_links
      WHERE integration = 'hubspot'
        AND entity_type = 'lead'
        AND external_entity_id = v_contact_id
        AND status = 'active'
      LIMIT 1;

      -- 8b. Match by leads.hubspot_contact_id
      IF v_matched_lead_id IS NULL THEN
        SELECT id INTO v_matched_lead_id
        FROM public.leads
        WHERE hubspot_contact_id = v_contact_id
          AND deleted_at IS NULL
        LIMIT 1;
      END IF;

      -- 8c. Match by primary or confirmation email
      IF v_matched_lead_id IS NULL AND v_email IS NOT NULL THEN
        SELECT l.id INTO v_matched_lead_id
        FROM public.leads l
        LEFT JOIN public.lead_emails le ON le.lead_id = l.id
        WHERE (lower(trim(l.email)) = v_email
           OR lower(trim(COALESCE(l.email_confirmation, ''))) = v_email
           OR lower(trim(COALESCE(le.normalized_email, ''))) = v_email)
          AND l.deleted_at IS NULL
        ORDER BY l.created_at ASC
        LIMIT 1;
      END IF;

      -- 8d. Match by normalized phone
      IF v_matched_lead_id IS NULL AND v_phone IS NOT NULL AND length(v_phone) >= 8 THEN
        SELECT id INTO v_matched_lead_id
        FROM public.leads
        WHERE (regexp_replace(COALESCE(phone_raw, phone_e164, ''), '\D', '', 'g') = v_phone
           OR regexp_replace(COALESCE(phone_raw, phone_e164, ''), '\D', '', 'g') LIKE '%' || substring(v_phone from length(v_phone) - 7))
          AND deleted_at IS NULL
        ORDER BY created_at ASC
        LIMIT 1;
      END IF;

      -- Anti-Resurrection Protection
      IF EXISTS (
        SELECT 1 FROM public.leads
        WHERE (hubspot_contact_id = v_contact_id OR (v_email IS NOT NULL AND lower(email) = v_email))
          AND deleted_at IS NOT NULL
      ) THEN
        v_ignored_count := v_ignored_count + 1;
        CONTINUE;
      END IF;

      -- 9. Lead Processing (Update vs Create)
      IF v_matched_lead_id IS NOT NULL THEN
        -- UPDATE RETURNING LEAD:
        -- Strictly preserve original created_at and pipeline stage.
        -- Update last_acquisition_at ONLY if v_authoritative_ts >= current last_acquisition_at!
        -- Never overwrite a more recent Meta or Website acquisition with an older HubSpot conversion.
        SELECT course_interest, course_interests
        INTO v_existing_lead_course, v_existing_course_interests
        FROM public.leads
        WHERE id = v_matched_lead_id;

        -- Accumulate course_interests JSONB
        v_merged_course_interests := COALESCE(v_existing_course_interests, '[]'::jsonb);
        IF v_course_interest_val IS NOT NULL AND trim(v_course_interest_val) != '' THEN
          IF NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(v_merged_course_interests) elem
            WHERE lower(trim(elem)) = lower(trim(v_course_interest_val))
               OR (lower(trim(v_course_interest_val)) LIKE '%zygo%' AND lower(trim(elem)) LIKE '%zygo%')
               OR (lower(trim(v_course_interest_val)) LIKE '%wisdom%' AND lower(trim(elem)) LIKE '%wisdom%')
               OR (lower(trim(v_course_interest_val)) LIKE '%intensiv%' AND lower(trim(elem)) LIKE '%intensiv%')
               OR (lower(trim(v_course_interest_val)) LIKE '%advanced%' AND lower(trim(elem)) LIKE '%advanced%')
          ) THEN
            v_merged_course_interests := v_merged_course_interests || jsonb_build_array(v_course_interest_val);
          END IF;
        END IF;

        -- Accumulate course_interest string
        IF v_existing_lead_course IS NULL OR trim(v_existing_lead_course) = '' THEN
          v_merged_course_interest := v_course_interest_val;
        ELSIF v_course_interest_val IS NOT NULL AND trim(v_course_interest_val) != '' THEN
          IF NOT (
            lower(v_existing_lead_course) LIKE '%' || lower(trim(v_course_interest_val)) || '%'
            OR (lower(trim(v_course_interest_val)) LIKE '%zygo%' AND lower(v_existing_lead_course) LIKE '%zygo%')
            OR (lower(trim(v_course_interest_val)) LIKE '%wisdom%' AND lower(v_existing_lead_course) LIKE '%wisdom%')
            OR (lower(trim(v_course_interest_val)) LIKE '%intensiv%' AND lower(v_existing_lead_course) LIKE '%intensiv%')
            OR (lower(trim(v_course_interest_val)) LIKE '%advanced%' AND lower(v_existing_lead_course) LIKE '%advanced%')
          ) THEN
            v_merged_course_interest := v_existing_lead_course || ', ' || v_course_interest_val;
          ELSE
            v_merged_course_interest := v_existing_lead_course;
          END IF;
        ELSE
          v_merged_course_interest := v_existing_lead_course;
        END IF;

        UPDATE public.leads
        SET
          first_name = COALESCE(v_first_name, first_name),
          last_name = COALESCE(v_last_name, last_name),
          email_confirmation = COALESCE(v_email_confirmation, email_confirmation),
          email_mismatch = (v_email_mismatch OR COALESCE(email_mismatch, false)),
          phone_raw = COALESCE(v_phone, phone_raw),
          contact_preference = COALESCE(v_contact_pref, contact_preference),
          hubspot_contact_id = COALESCE(hubspot_contact_id, v_contact_id),
          source_created_at = COALESCE(source_created_at, v_source_created_at),
          course_interest = v_merged_course_interest,
          course_interests = v_merged_course_interests,
          last_acquisition_at = GREATEST(COALESCE(last_acquisition_at, '-infinity'::timestamptz), v_authoritative_ts),
          last_inbound_activity_at = GREATEST(COALESCE(last_inbound_activity_at, '-infinity'::timestamptz), v_authoritative_ts),
          has_new_submission = true,
          new_submission_at = GREATEST(COALESCE(new_submission_at, '-infinity'::timestamptz), v_authoritative_ts),
          updated_at = now()
        WHERE id = v_matched_lead_id;

        -- Relational lead_course_interests linking for returning lead
        IF v_course_interest_val IS NOT NULL AND trim(v_course_interest_val) != '' THEN
          SELECT id INTO v_resolved_course_id
          FROM public.courses
          WHERE active = true
            AND (
              lower(name) = lower(v_course_interest_val)
              OR lower(code) = lower(v_course_interest_val)
              OR lower(name) LIKE '%' || lower(v_course_interest_val) || '%'
              OR (lower(v_course_interest_val) LIKE '%zygo%' AND lower(name) LIKE '%zygo%')
              OR (lower(v_course_interest_val) LIKE '%wisdom%' AND lower(name) LIKE '%wisdom%')
              OR (lower(v_course_interest_val) LIKE '%intensiv%' AND lower(name) LIKE '%intensiv%')
              OR (lower(v_course_interest_val) LIKE '%advanced%' AND lower(name) LIKE '%advanced%')
              OR (lower(v_course_interest_val) LIKE '%endo%' AND lower(name) LIKE '%endo%')
              OR (lower(v_course_interest_val) LIKE '%perio%' AND lower(name) LIKE '%perio%')
              OR (lower(v_course_interest_val) LIKE '%rehab%' AND lower(name) LIKE '%rehab%')
            )
          LIMIT 1;

          IF v_resolved_course_id IS NOT NULL THEN
            IF NOT EXISTS (
              SELECT 1 FROM public.lead_course_interests
              WHERE lead_id = v_matched_lead_id AND course_id = v_resolved_course_id
            ) THEN
              SELECT slot INTO v_slot
              FROM unnest(ARRAY[1, 2, 3]) AS slot
              WHERE slot NOT IN (
                SELECT priority FROM public.lead_course_interests
                WHERE lead_id = v_matched_lead_id AND priority IS NOT NULL
              )
              ORDER BY slot ASC
              LIMIT 1;

              INSERT INTO public.lead_course_interests (
                lead_id, course_id, priority, source, status, created_at, updated_at
              ) VALUES (
                v_matched_lead_id,
                v_resolved_course_id,
                v_slot,
                'hubspot',
                'active',
                now(),
                now()
              ) ON CONFLICT (lead_id, course_id) DO NOTHING;
            END IF;
          END IF;
        END IF;

        PERFORM public.sync_lead_emails(v_matched_lead_id, v_email_resolution->'emails');

        -- Safe integration_entity_links Upsert (Conflict-safe for dual unique indexes)
        SELECT id, external_entity_id INTO v_existing_active_link
        FROM public.integration_entity_links
        WHERE integration = 'hubspot'
          AND entity_type = 'lead'
          AND eds_entity_id = v_matched_lead_id
          AND status = 'active'
        LIMIT 1;

        IF v_existing_active_link.id IS NOT NULL AND v_existing_active_link.external_entity_id <> v_contact_id THEN
          INSERT INTO public.integration_entity_links (
            integration, entity_type, external_entity_id, eds_entity_id, status, created_at, updated_at
          ) VALUES (
            'hubspot', 'lead', v_contact_id, v_matched_lead_id, 'archived', now(), now()
          ) ON CONFLICT (integration, entity_type, external_entity_id) WHERE status = 'active'
          DO NOTHING;
        ELSE
          INSERT INTO public.integration_entity_links (
            integration, entity_type, external_entity_id, eds_entity_id, status, created_at, updated_at
          ) VALUES (
            'hubspot', 'lead', v_contact_id, v_matched_lead_id, 'active', now(), now()
          ) ON CONFLICT (integration, entity_type, external_entity_id) WHERE status = 'active'
          DO UPDATE SET
            eds_entity_id = EXCLUDED.eds_entity_id,
            updated_at = now();
        END IF;

        -- Record activity for returning lead re-entry
        INSERT INTO public.lead_activities (
          lead_id, activity_type, actor_type, summary, metadata, created_at
        ) VALUES (
          v_matched_lead_id, 'form_submitted', 'system',
          v_activity_summary,
          jsonb_build_object(
            'hubspot_contact_id', v_contact_id,
            'source', v_source,
            'source_detail', v_source_detail,
            'course', v_course_interest_val,
            'intent', v_intent,
            'form_name', COALESCE(v_props->>'recent_conversion_event_name', v_props->>'first_conversion_event_name')
          ),
          v_authoritative_ts
        );

        -- Record form_submissions entry
        IF v_first_conv != '' OR v_recent_conv != '' THEN
          INSERT INTO public.form_submissions (
            lead_id, form_name, source, source_detail, course_interest, submitted_at, submitted_data,
            email, email_confirmation, email_mismatch, phone_e164, contact_preference,
            processing_status, recovery_state, idempotency_key
          ) VALUES (
            v_matched_lead_id,
            COALESCE(NULLIF(trim(v_props->>'recent_conversion_event_name'), ''), NULLIF(trim(v_props->>'first_conversion_event_name'), ''), 'HubSpot Form Submission'),
            CASE WHEN v_source = 'website' THEN 'Site' WHEN v_source = 'meta' THEN 'Meta Lead Ads' ELSE initcap(v_source) END,
            v_source_detail,
            v_course_interest_val,
            v_authoritative_ts,
            v_props,
            v_email,
            v_email_confirmation,
            v_email_mismatch,
            v_phone,
            v_contact_pref,
            'processed',
            'complete',
            'hubspot_form_sub:' || v_contact_id || ':' || md5(COALESCE(v_props->>'recent_conversion_event_name', v_props->>'first_conversion_event_name', v_course_interest_val, 'sub'))
          ) ON CONFLICT (idempotency_key) DO NOTHING;
        END IF;

        v_updated_count := v_updated_count + 1;

      -- CREATE NEW LEAD
      ELSE
        INSERT INTO public.leads (
          source, source_detail,
          first_name, last_name, email, email_confirmation, email_mismatch,
          phone_raw, contact_preference, course_interest, course_interests,
          pipeline_stage_id, hubspot_contact_id, source_created_at,
          last_inbound_activity_at, last_acquisition_at, created_at, updated_at
        ) VALUES (
          v_source, v_source_detail,
          COALESCE(v_first_name, 'Lead'), v_last_name, v_email, v_email_confirmation, v_email_mismatch,
          v_phone, v_contact_pref, v_course_interest_val,
          CASE WHEN v_course_interest_val IS NOT NULL THEN jsonb_build_array(v_course_interest_val) ELSE '[]'::jsonb END,
          v_capture_stage_id, v_contact_id, v_source_created_at,
          v_authoritative_ts, v_authoritative_ts, COALESCE(v_source_created_at, v_authoritative_ts), now()
        ) RETURNING id INTO v_matched_lead_id;

        PERFORM public.sync_lead_emails(v_matched_lead_id, v_email_resolution->'emails');

        INSERT INTO public.lead_stage_history (
          lead_id, from_stage_id, to_stage_id, change_reason
        ) VALUES (
          v_matched_lead_id, NULL, v_capture_stage_id, 'initial_assignment'
        );

        -- Safe integration_entity_links Upsert
        SELECT id, external_entity_id INTO v_existing_active_link
        FROM public.integration_entity_links
        WHERE integration = 'hubspot'
          AND entity_type = 'lead'
          AND eds_entity_id = v_matched_lead_id
          AND status = 'active'
        LIMIT 1;

        IF v_existing_active_link.id IS NOT NULL AND v_existing_active_link.external_entity_id <> v_contact_id THEN
          INSERT INTO public.integration_entity_links (
            integration, entity_type, external_entity_id, eds_entity_id, status, created_at, updated_at
          ) VALUES (
            'hubspot', 'lead', v_contact_id, v_matched_lead_id, 'archived', now(), now()
          ) ON CONFLICT (integration, entity_type, external_entity_id) WHERE status = 'active'
          DO NOTHING;
        ELSE
          INSERT INTO public.integration_entity_links (
            integration, entity_type, external_entity_id, eds_entity_id, status, created_at, updated_at
          ) VALUES (
            'hubspot', 'lead', v_contact_id, v_matched_lead_id, 'active', now(), now()
          ) ON CONFLICT (integration, entity_type, external_entity_id) WHERE status = 'active'
          DO UPDATE SET
            eds_entity_id = EXCLUDED.eds_entity_id,
            updated_at = now();
        END IF;

        IF v_first_conv != '' OR v_recent_conv != '' THEN
          INSERT INTO public.form_submissions (
            lead_id, form_name, source, source_detail, course_interest, submitted_at, submitted_data,
            email, email_confirmation, email_mismatch, phone_e164, contact_preference,
            processing_status, recovery_state, idempotency_key
          ) VALUES (
            v_matched_lead_id,
            COALESCE(NULLIF(trim(v_props->>'recent_conversion_event_name'), ''), NULLIF(trim(v_props->>'first_conversion_event_name'), ''), 'HubSpot Form Submission'),
            CASE WHEN v_source = 'website' THEN 'Site' WHEN v_source = 'meta' THEN 'Meta Lead Ads' ELSE initcap(v_source) END,
            v_source_detail,
            v_course_interest_val,
            v_authoritative_ts,
            v_props,
            v_email,
            v_email_confirmation,
            v_email_mismatch,
            v_phone,
            v_contact_pref,
            'processed',
            'complete',
            'hubspot_form_sub:' || v_contact_id || ':' || md5(COALESCE(v_props->>'recent_conversion_event_name', v_props->>'first_conversion_event_name', v_course_interest_val, 'sub'))
          ) ON CONFLICT (idempotency_key) DO NOTHING;
        END IF;

        INSERT INTO public.lead_activities (
          lead_id, activity_type, actor_type, summary, metadata, created_at
        ) VALUES (
          v_matched_lead_id, 'lead_created', 'system',
          v_activity_summary,
          jsonb_build_object(
            'hubspot_contact_id', v_contact_id,
            'source', v_source,
            'source_detail', v_source_detail,
            'course', v_course_interest_val,
            'intent', v_intent,
            'createdate', v_source_created_at
          ),
          v_authoritative_ts
        );

        -- Resolve course_id for new lead
        IF v_course_interest_val IS NOT NULL AND trim(v_course_interest_val) != '' THEN
          SELECT id INTO v_resolved_course_id
          FROM public.courses
          WHERE active = true
            AND (
              lower(name) = lower(v_course_interest_val)
              OR lower(code) = lower(v_course_interest_val)
              OR lower(name) LIKE '%' || lower(v_course_interest_val) || '%'
              OR (lower(v_course_interest_val) LIKE '%zygo%' AND lower(name) LIKE '%zygo%')
              OR (lower(v_course_interest_val) LIKE '%wisdom%' AND lower(name) LIKE '%wisdom%')
              OR (lower(v_course_interest_val) LIKE '%intensiv%' AND lower(name) LIKE '%intensiv%')
              OR (lower(v_course_interest_val) LIKE '%advanced%' AND lower(name) LIKE '%advanced%')
              OR (lower(v_course_interest_val) LIKE '%endo%' AND lower(name) LIKE '%endo%')
              OR (lower(v_course_interest_val) LIKE '%perio%' AND lower(name) LIKE '%perio%')
              OR (lower(v_course_interest_val) LIKE '%rehab%' AND lower(name) LIKE '%rehab%')
            )
          LIMIT 1;

          IF v_resolved_course_id IS NOT NULL THEN
            INSERT INTO public.lead_course_interests (
              lead_id, course_id, priority, source, status, created_at, updated_at
            ) VALUES (
              v_matched_lead_id, v_resolved_course_id, 1, 'hubspot', 'active', now(), now()
            ) ON CONFLICT (lead_id, course_id) DO NOTHING;
          END IF;
        END IF;

        v_created_count := v_created_count + 1;
        v_created_leads := v_created_leads || jsonb_build_object(
          'id', v_matched_lead_id,
          'source', v_source,
          'source_detail', v_source_detail,
          'course_interest', v_course_interest_val,
          'created_at', v_authoritative_ts,
          'email', v_email,
          'phone', v_phone,
          'hubspot_contact_id', v_contact_id
        );
      END IF;

      -- Log sync event
      INSERT INTO public.integration_sync_events (
        connection_id, provider, event_type, status,
        payload, details, created_at
      ) VALUES (
        p_connection_id,
        'hubspot',
        'contact.upsert',
        'completed',
        v_event,
        jsonb_build_object(
          'lead_id', v_matched_lead_id,
          'is_update', (v_matched_lead_id IS NOT NULL),
          'source', v_source,
          'source_detail', v_source_detail,
          'intent', v_intent
        ),
        now()
      );

    EXCEPTION WHEN OTHERS THEN
      v_conflict_count := v_conflict_count + 1;
      INSERT INTO public.integration_conflicts (
        integration, entity_type, external_entity_id, conflict_type,
        conflict_summary, error_message, hubspot_data
      ) VALUES (
        'hubspot', 'lead', v_contact_id, 'INBOUND_PROCESSING_ERROR',
        'Error processing inbound HubSpot contact ' || v_contact_id,
        SQLERRM, v_props
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'total_received', jsonb_array_length(p_events),
    'created', v_created_count,
    'updated', v_updated_count,
    'ignored', v_ignored_count,
    'conflicts', v_conflict_count,
    'created_leads', v_created_leads
  );
END;
$$;

-- Factual data repair for Rohan Sharma (280c99b6-dcac-4f35-ab71-eb186bc24f3e)
-- Accumulate both Advanced Dental Implant Experience + Wisdom Teeth Training
UPDATE public.leads
SET
  course_interests = '["Advanced Dental Implant Experience", "Wisdom Teeth Training"]'::jsonb,
  course_interest = 'Advanced Dental Implant Experience, Wisdom Teeth Training',
  updated_at = now()
WHERE id = '280c99b6-dcac-4f35-ab71-eb186bc24f3e';

-- Insert Wisdom Teeth Training (3b306c26-a056-4da7-abe4-0a9af088e9f1) into lead_course_interests
INSERT INTO public.lead_course_interests (
  lead_id, course_id, priority, source, status, created_at, updated_at
) VALUES (
  '280c99b6-dcac-4f35-ab71-eb186bc24f3e',
  '3b306c26-a056-4da7-abe4-0a9af088e9f1',
  2,
  'meta',
  'active',
  now(),
  now()
) ON CONFLICT (lead_id, course_id) DO NOTHING;
