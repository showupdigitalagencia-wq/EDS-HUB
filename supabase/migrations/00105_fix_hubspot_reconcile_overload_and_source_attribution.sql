-- =============================================================================
-- Migration 00105: Fix HubSpot Reconcile Function Overload & Source Attribution
-- =============================================================================
-- 1. Drops ambiguous overloaded signatures of process_hubspot_inbound_batch
-- 2. Defines single unified process_hubspot_inbound_batch with:
--    - Authoritative source timestamp priority (recent_conversion_date > first_conv > hs_analytics > createdate > event_ts > now())
--    - Factual acquisition source attribution (preserving Meta / Instagram / Facebook / Website / HubSpot)
--    - Conflict-safe integration_entity_links handling (preventing 23505 unique constraint crashes)
--    - Canonical lead resolution across primary email, secondary lead_emails, phone, and links
--    - Stage preservation for returning leads (never reset stage, update last_acquisition_at)
--    - Valid change_reason for lead_stage_history ('initial_assignment')
--    - Exact integration_sync_events column alignment
--    - Complete form_submissions, lead_activities, and lead_course_interests recording
-- =============================================================================

-- Step 1: Drop ambiguous overloaded signatures
DROP FUNCTION IF EXISTS public.process_hubspot_inbound_batch(jsonb, uuid);
DROP FUNCTION IF EXISTS public.process_hubspot_inbound_batch(jsonb);

-- Step 2: Create single unified function
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

      v_event_id := NULLIF(trim(COALESCE(v_event->>'eventId', v_event->>'id', '')), '');

      IF v_event->>'occurredAt' IS NOT NULL THEN
        v_event_ts := to_timestamp((v_event->>'occurredAt')::double precision / 1000.0);
      ELSIF v_event->>'timestamp' IS NOT NULL THEN
        v_event_ts := public.parse_authoritative_timestamp(v_event->>'timestamp');
      ELSE
        v_event_ts := now();
      END IF;

      v_props := COALESCE(v_event->'properties', '{}'::jsonb);

      -- Parse source createdate
      IF v_props->>'createdate' IS NOT NULL THEN
        v_source_created_at := public.parse_authoritative_timestamp(v_props->>'createdate');
      ELSE
        v_source_created_at := NULL;
      END IF;

      -- Authoritative Acquisition Timestamp Resolution Priority:
      -- 1. factual form conversion timestamp (recent_conversion_date)
      -- 2. first_conversion_date
      -- 3. hs_analytics_latest_source_timestamp
      -- 4. source createdate
      -- 5. event timestamp (occurredAt)
      -- 6. now() ONLY as final fallback
      v_authoritative_ts := COALESCE(
        public.parse_authoritative_timestamp(v_props->>'recent_conversion_date'),
        public.parse_authoritative_timestamp(v_props->>'first_conversion_date'),
        public.parse_authoritative_timestamp(v_props->>'hs_analytics_latest_source_timestamp'),
        v_source_created_at,
        v_event_ts,
        now()
      );

      -- Fallback property extraction from outer event if not nested
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

      v_payload_hash := md5(v_props::text);

      -- 2. Resolve Emails (Primary, Confirmation, Mismatch)
      v_email_resolution := public.resolve_lead_emails(v_props, 'hubspot');
      v_email := v_email_resolution->>'primary_email';
      v_email_mismatch := COALESCE((v_email_resolution->>'divergence')::boolean, false);

      IF jsonb_array_length(v_email_resolution->'emails') > 1 THEN
        v_email_confirmation := v_email_resolution->'emails'->1->>'normalized_email';
      ELSE
        v_email_confirmation := v_email;
      END IF;

      -- 3. Phone Resolution
      v_phone := NULLIF(trim(COALESCE(
        v_props->>'phone',
        v_props->>'mobilephone',
        v_props->>'hs_calculated_phone_number',
        v_props->>'whatsapp',
        v_props->>'telefone',
        v_props->>'celular',
        ''
      )), '');

      -- 4. Name Resolution
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

      IF v_first_name IS NULL AND v_last_name IS NULL AND v_props->>'hs_full_name_or_email' IS NOT NULL THEN
        v_first_name := trim(v_props->>'hs_full_name_or_email');
      END IF;

      -- 5. Contact Preference
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

      -- 6. Course Interest Extraction & Normalization
      v_raw_course_interest := NULLIF(trim(COALESCE(
        v_props->>'curso_de_interesse',
        v_props->>'course_interest',
        v_props->>'qual_o_seu_interesse_',
        v_props->>'qual_o_seu_interesse',
        v_props->>'curso_de_interesse_2',
        v_props->>'curso_de_interesse_3',
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
        AND external_entity_id = v_contact_id
        AND status = 'active'
      LIMIT 1;

      -- 8b. Match by hubspot_contact_id on leads table
      IF v_matched_lead_id IS NULL THEN
        SELECT id INTO v_matched_lead_id
        FROM public.leads
        WHERE hubspot_contact_id = v_contact_id
          AND deleted_at IS NULL
        LIMIT 1;
      END IF;

      -- 8c. Match by primary or secondary email
      IF v_matched_lead_id IS NULL AND v_email IS NOT NULL AND v_email != '' THEN
        SELECT id INTO v_matched_lead_id
        FROM public.leads
        WHERE lower(email) = v_email
          AND deleted_at IS NULL
        ORDER BY created_at ASC
        LIMIT 1;

        IF v_matched_lead_id IS NULL THEN
          SELECT lead_id INTO v_matched_lead_id
          FROM public.lead_emails
          WHERE normalized_email = v_email
          LIMIT 1;
        END IF;
      END IF;

      -- 8d. Match by phone
      IF v_matched_lead_id IS NULL AND v_phone IS NOT NULL AND v_phone != '' THEN
        SELECT id INTO v_matched_lead_id
        FROM public.leads
        WHERE (phone_e164 = v_phone OR phone_raw = v_phone)
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
        -- Update last_acquisition_at to authoritative timestamp to resurface card in pipeline.
        -- Merge course interest into course_interests array without duplicates.
        SELECT course_interest, course_interests
        INTO v_existing_lead_course, v_existing_course_interests
        FROM public.leads
        WHERE id = v_matched_lead_id;

        v_merged_course_interests := COALESCE(v_existing_course_interests, '[]'::jsonb);
        IF v_course_interest_val IS NOT NULL AND trim(v_course_interest_val) != '' THEN
          IF NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(v_merged_course_interests) elem
            WHERE lower(trim(elem)) = lower(trim(v_course_interest_val))
          ) THEN
            v_merged_course_interests := v_merged_course_interests || jsonb_build_array(v_course_interest_val);
          END IF;
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
          course_interest = COALESCE(course_interest, v_course_interest_val),
          course_interests = v_merged_course_interests,
          last_acquisition_at = v_authoritative_ts,
          last_inbound_activity_at = v_authoritative_ts,
          has_new_submission = true,
          new_submission_at = v_authoritative_ts,
          updated_at = now()
        WHERE id = v_matched_lead_id;

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
          -- Another external contact ID is already active for this lead.
          -- Record this contact as secondary alias link without violating idx_integration_entity_links_active_eds.
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
      ELSE
        -- CREATE NEW CANONICAL LEAD
        INSERT INTO public.leads (
          source, source_detail, first_name, last_name, email, email_confirmation, email_mismatch,
          phone_raw, contact_preference, course_interest, course_interests,
          pipeline_stage_id, hubspot_contact_id, source_created_at,
          last_acquisition_at, last_inbound_activity_at, created_at, updated_at
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

        INSERT INTO public.lead_activities (
          lead_id, activity_type, actor_type, summary, metadata, created_at
        ) VALUES (
          v_matched_lead_id,
          CASE WHEN v_source_detail = 'contact_form' THEN 'form_submitted' ELSE 'lead_created' END,
          'system',
          v_activity_summary,
          jsonb_build_object(
            'hubspot_contact_id', v_contact_id,
            'source', v_source,
            'source_detail', v_source_detail,
            'course', v_course_interest_val,
            'intent', v_intent,
            'form_name', COALESCE(v_props->>'first_conversion_event_name', v_props->>'recent_conversion_event_name')
          ),
          v_authoritative_ts
        );

        IF v_first_conv != '' OR v_recent_conv != '' THEN
          INSERT INTO public.form_submissions (
            lead_id, form_name, source, source_detail, course_interest, submitted_at, submitted_data,
            email, email_confirmation, email_mismatch, phone_e164, contact_preference,
            processing_status, recovery_state, idempotency_key
          ) VALUES (
            v_matched_lead_id,
            COALESCE(NULLIF(trim(v_props->>'first_conversion_event_name'), ''), NULLIF(trim(v_props->>'recent_conversion_event_name'), ''), 'HubSpot Form Submission'),
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
            'hubspot_form_sub:' || v_contact_id || ':' || md5(COALESCE(v_props->>'first_conversion_event_name', v_props->>'recent_conversion_event_name', v_course_interest_val, 'sub'))
          ) ON CONFLICT (idempotency_key) DO NOTHING;
        END IF;

        v_created_leads := v_created_leads || jsonb_build_array(jsonb_build_object(
          'lead_id', v_matched_lead_id,
          'hubspot_contact_id', v_contact_id,
          'email', v_email,
          'email_confirmation', v_email_confirmation,
          'email_mismatch', v_email_mismatch,
          'resolved_emails', v_email_resolution->'emails',
          'phone', v_phone,
          'first_name', v_first_name,
          'last_name', v_last_name,
          'source', v_source,
          'source_detail', v_source_detail,
          'source_created_at', v_source_created_at,
          'authoritative_timestamp', v_authoritative_ts,
          'course_interest', v_course_interest_val,
          'contact_preference', v_contact_pref
        ));

        v_created_count := v_created_count + 1;
      END IF;

      -- Sync audit event
      INSERT INTO public.integration_sync_events (
        integration, direction, entity_type, eds_entity_id, external_entity_id,
        event_type, external_event_id, external_event_timestamp, payload_hash,
        status, attempt_count, change_summary, created_at, processed_at
      ) VALUES (
        'hubspot', 'inbound', 'lead', v_matched_lead_id, v_contact_id,
        'contact_synced', COALESCE(v_event_id, 'sync:' || v_contact_id || ':' || extract(epoch from now())::text),
        v_event_ts, COALESCE(v_payload_hash, 'none'),
        'completed', 1, jsonb_build_object('source', v_source, 'source_detail', v_source_detail),
        now(), now()
      ) ON CONFLICT DO NOTHING;

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

      v_conflict_count := v_conflict_count + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'total_events', jsonb_array_length(p_events),
    'created_count', v_created_count,
    'updated_count', v_updated_count,
    'ignored_count', v_ignored_count,
    'conflict_count', v_conflict_count,
    'errors', v_conflict_count,
    'created_leads', v_created_leads
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_hubspot_inbound_batch(JSONB, UUID) TO service_role, authenticated, postgres;
