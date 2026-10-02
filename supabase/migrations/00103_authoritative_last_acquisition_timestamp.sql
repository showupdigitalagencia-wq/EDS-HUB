-- =============================================================================
-- Migration 00103: Authoritative Source Timestamp Priority for Inbound Re-engagement
-- =============================================================================
-- Enforces the Authoritative Source Timestamp rule for all inbound acquisitions
-- Priority:
-- 1. Factual submission timestamp (submitted_at / submission_time)
-- 2. Meta created_time
-- 3. HubSpot conversion/submission timestamp (recent_conversion_date, etc.)
-- 4. Website factual submitted_at
-- 5. Provider / source event timestamp (occurredAt, timestamp, source_created_at)
-- 6. ONLY as last fallback: now()
--
-- Strictly prevents processing time from overriding factual entry timestamps.
-- =============================================================================

-- 1. Helper function for safe parsing of heterogeneous timestamps (ISO, epoch ms, epoch s)
CREATE OR REPLACE FUNCTION public.parse_authoritative_timestamp(p_val TEXT)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_val IS NULL OR trim(p_val) = '' THEN
    RETURN NULL;
  END IF;
  IF trim(p_val) ~ '^\d+$' THEN
    IF length(trim(p_val)) >= 12 THEN
      RETURN to_timestamp((trim(p_val)::double precision) / 1000.0);
    ELSE
      RETURN to_timestamp(trim(p_val)::double precision);
    END IF;
  ELSE
    RETURN trim(p_val)::timestamptz;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.parse_authoritative_timestamp(TEXT) TO postgres, authenticated, service_role;

-- 2. Update process_form_submission_transaction with Authoritative Timestamp Resolution
CREATE OR REPLACE FUNCTION public.process_form_submission_transaction(
  p_form_slug TEXT,
  p_idempotency_key TEXT,
  p_submitted_data JSONB,
  p_email TEXT,
  p_phone_e164 TEXT,
  p_contact_preference TEXT,
  p_course_interest TEXT,
  p_ip_address TEXT,
  p_user_agent TEXT,
  p_external_attempt_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_form RECORD;
  v_existing_sub RECORD;
  v_lead_by_email UUID;
  v_lead_by_phone UUID;
  v_target_lead_id UUID;
  v_email_resolution JSONB;
  v_clean_email TEXT;
  v_clean_email_conf TEXT;
  v_email_mismatch BOOLEAN := false;
  v_clean_phone_raw TEXT;
  v_first_name TEXT;
  v_last_name TEXT;
  v_pref TEXT;
  v_clean_course TEXT;
  v_existing_course_interest TEXT;
  v_existing_course_interests JSONB;
  v_merged_course_interests JSONB;
  v_merged_course_interest TEXT;
  v_intake_event_id UUID;
  v_submission_id UUID;
  v_assigned_source TEXT;
  v_assigned_source_detail TEXT;
  v_intent TEXT;
  v_activity_summary TEXT;
  v_authoritative_ts TIMESTAMPTZ;
BEGIN
  -- 1. Fetch Form
  SELECT id, slug, name, current_version, status, default_pipeline_stage_id,
         success_message, redirect_url, source_detail
  INTO v_form
  FROM public.forms
  WHERE slug = p_form_slug
  LIMIT 1;

  IF NOT FOUND OR v_form.status != 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Form not found or inactive');
  END IF;

  -- 2. Idempotency Check
  SELECT id, lead_id, intake_event_id, processing_status
  INTO v_existing_sub
  FROM public.form_submissions
  WHERE idempotency_key = p_idempotency_key
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'is_duplicate', true,
      'submission_id', v_existing_sub.id,
      'lead_id', v_existing_sub.lead_id,
      'intake_event_id', v_existing_sub.intake_event_id,
      'processing_status', v_existing_sub.processing_status,
      'success_message', v_form.success_message,
      'redirect_url', v_form.redirect_url
    );
  END IF;

  -- 3. Resolve Authoritative Inbound Timestamp
  -- Priority:
  -- 1. Factual submission timestamp (submitted_at)
  -- 2. Meta created_time
  -- 3. HubSpot conversion_time / recent_conversion_date
  -- 4. source_created_at
  -- 5. event_timestamp / timestamp
  -- 6. ONLY as last fallback: now()
  v_authoritative_ts := COALESCE(
    public.parse_authoritative_timestamp(p_submitted_data->>'submitted_at'),
    public.parse_authoritative_timestamp(p_submitted_data->>'created_time'),
    public.parse_authoritative_timestamp(p_submitted_data->>'conversion_time'),
    public.parse_authoritative_timestamp(p_submitted_data->>'recent_conversion_date'),
    public.parse_authoritative_timestamp(p_submitted_data->>'source_created_at'),
    public.parse_authoritative_timestamp(p_submitted_data->>'event_timestamp'),
    public.parse_authoritative_timestamp(p_submitted_data->>'timestamp'),
    now()
  );

  -- 4. Canonical Multi-Email Resolution
  v_email_resolution := public.resolve_lead_emails(p_submitted_data, 'form');
  v_clean_email := v_email_resolution->>'primary_email';
  v_email_mismatch := COALESCE((v_email_resolution->>'divergence')::boolean, false);

  IF jsonb_array_length(v_email_resolution->'emails') > 1 THEN
    v_clean_email_conf := v_email_resolution->'emails'->1->>'normalized_email';
  ELSE
    v_clean_email_conf := v_clean_email;
  END IF;

  -- Check existing lead by primary email or lead_emails
  v_lead_by_email := NULL;
  IF v_clean_email IS NOT NULL AND v_clean_email != '' THEN
    SELECT id INTO v_lead_by_email
    FROM public.leads
    WHERE lower(email) = v_clean_email
      AND deleted_at IS NULL
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_lead_by_email IS NULL THEN
      SELECT lead_id INTO v_lead_by_email
      FROM public.lead_emails
      WHERE normalized_email = v_clean_email
      LIMIT 1;
    END IF;
  END IF;

  -- Check existing lead by phone
  v_lead_by_phone := NULL;
  IF p_phone_e164 IS NOT NULL AND p_phone_e164 != '' THEN
    SELECT id INTO v_lead_by_phone
    FROM public.leads
    WHERE phone_e164 = p_phone_e164
      AND deleted_at IS NULL
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  -- Deduplication / Target resolution
  v_target_lead_id := COALESCE(v_lead_by_email, v_lead_by_phone);

  -- 5. Prepare Lead Attributes
  v_clean_phone_raw := NULLIF(trim(COALESCE(p_submitted_data->>'phone', p_submitted_data->>'phone_raw', '')), '');
  v_first_name := NULLIF(trim(COALESCE(p_submitted_data->>'first_name', p_submitted_data->>'firstname', p_submitted_data->>'name', 'Lead')), '');
  v_last_name := NULLIF(trim(COALESCE(p_submitted_data->>'last_name', p_submitted_data->>'lastname', '')), '');

  v_pref := lower(NULLIF(trim(COALESCE(p_contact_preference, p_submitted_data->>'contact_preference', 'email')), ''));
  IF v_pref NOT IN ('email', 'sms', 'call', 'whatsapp') THEN
    v_pref := 'email';
  END IF;

  v_clean_course := NULLIF(trim(COALESCE(p_course_interest, p_submitted_data->>'course_interest', p_submitted_data->>'course', '')), '');

  -- 6. Intent Classification
  IF v_form.slug IN ('contact', 'contact-form', 'fale-conosco', 'course-info', 'course-information')
     OR v_form.name ILIKE '%course info%'
     OR v_form.name ILIKE '%request course information%'
     OR v_form.source_detail = 'contact_form' THEN
    v_assigned_source := 'website';
    v_assigned_source_detail := 'contact_form';
    IF v_clean_course IS NOT NULL AND v_clean_course != '' THEN
      v_intent := 'COURSE_INFORMATION_REQUEST';
      v_activity_summary := 'Solicitou informações sobre ' || v_clean_course;
    ELSE
      v_intent := 'GENERAL_CONTACT';
      v_activity_summary := 'Entrou em contato pelo formulário do site';
    END IF;
  ELSIF v_form.slug IN ('registration', 'matricula', 'checkout') OR v_form.source_detail = 'website_registration_form' THEN
    v_assigned_source := 'website';
    v_assigned_source_detail := 'website_registration_form';
    v_intent := 'COMPLETED_ENROLLMENT';
    v_activity_summary := 'Inscrição concluída no site: ' || COALESCE(v_clean_course, 'Curso');
  ELSE
    v_assigned_source := 'website';
    v_assigned_source_detail := COALESCE(v_form.source_detail, 'website');
    v_intent := 'UNKNOWN';
    v_activity_summary := 'Formulário recebido: ' || v_form.name;
  END IF;

  IF v_target_lead_id IS NULL THEN
    -- NEW LEAD: Create in default stage (Novo Lead / Capture)
    INSERT INTO public.leads (
      source, source_detail, first_name, last_name, email, email_confirmation, email_mismatch,
      phone_raw, phone_e164, contact_preference, course_interest,
      course_interests, pipeline_stage_id, last_acquisition_at, last_inbound_activity_at,
      has_new_submission, new_submission_at, created_at, updated_at
    ) VALUES (
      v_assigned_source, v_assigned_source_detail, v_first_name, v_last_name, v_clean_email, v_clean_email_conf, v_email_mismatch,
      v_clean_phone_raw, p_phone_e164,
      v_pref, v_clean_course,
      CASE WHEN v_clean_course IS NOT NULL THEN jsonb_build_array(v_clean_course) ELSE '[]'::jsonb END,
      v_form.default_pipeline_stage_id, v_authoritative_ts, v_authoritative_ts,
      false, NULL, v_authoritative_ts, now()
    ) RETURNING id INTO v_target_lead_id;

    PERFORM public.sync_lead_emails(v_target_lead_id, v_email_resolution->'emails');

    INSERT INTO public.lead_stage_history (
      lead_id, from_stage_id, to_stage_id, change_reason
    ) VALUES (
      v_target_lead_id, NULL, v_form.default_pipeline_stage_id, 'initial_assignment'
    );

    INSERT INTO public.lead_activities (
      lead_id, activity_type, actor_type, summary, metadata, created_at
    ) VALUES (
      v_target_lead_id, 'form_submitted', 'system',
      v_activity_summary,
      jsonb_build_object(
        'form_id', v_form.id,
        'form_slug', v_form.slug,
        'form_name', v_form.name,
        'source', v_assigned_source,
        'source_detail', v_assigned_source_detail,
        'course', v_clean_course,
        'intent', v_intent,
        'message', p_submitted_data->>'message'
      ),
      v_authoritative_ts
    );
  ELSE
    -- REPEAT SUBMISSION: Update existing lead, resurface card to TOP of current stage via Authoritative Timestamp!
    -- Strictly preserve original created_at and pipeline stage.
    SELECT course_interest, course_interests
    INTO v_existing_course_interest, v_existing_course_interests
    FROM public.leads
    WHERE id = v_target_lead_id;

    v_merged_course_interests := COALESCE(v_existing_course_interests, '[]'::jsonb);
    v_merged_course_interest := v_existing_course_interest;

    IF v_clean_course IS NOT NULL AND v_clean_course != '' THEN
      IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(v_merged_course_interests) AS elem
        WHERE lower(trim(elem)) = lower(trim(v_clean_course))
      ) THEN
        v_merged_course_interests := v_merged_course_interests || jsonb_build_array(v_clean_course);
      END IF;

      IF v_merged_course_interest IS NULL OR trim(v_merged_course_interest) = '' THEN
        v_merged_course_interest := v_clean_course;
      END IF;
    END IF;

    UPDATE public.leads
    SET
      first_name = COALESCE(v_first_name, first_name),
      last_name = COALESCE(v_last_name, last_name),
      phone_raw = COALESCE(v_clean_phone_raw, phone_raw),
      phone_e164 = COALESCE(p_phone_e164, phone_e164),
      email_confirmation = COALESCE(v_clean_email_conf, email_confirmation),
      email_mismatch = (v_email_mismatch OR COALESCE(email_mismatch, false)),
      contact_preference = COALESCE(v_pref, contact_preference),
      course_interest = v_merged_course_interest,
      course_interests = v_merged_course_interests,
      last_acquisition_at = v_authoritative_ts,
      last_inbound_activity_at = v_authoritative_ts,
      has_new_submission = true,
      new_submission_at = v_authoritative_ts,
      updated_at = now()
    WHERE id = v_target_lead_id;

    PERFORM public.sync_lead_emails(v_target_lead_id, v_email_resolution->'emails');

    INSERT INTO public.lead_activities (
      lead_id, activity_type, actor_type, summary, metadata, created_at
    ) VALUES (
      v_target_lead_id, 'form_submitted', 'system',
      v_activity_summary,
      jsonb_build_object(
        'form_id', v_form.id,
        'form_slug', v_form.slug,
        'form_name', v_form.name,
        'source', v_assigned_source,
        'source_detail', v_assigned_source_detail,
        'course', v_clean_course,
        'intent', v_intent,
        'message', p_submitted_data->>'message'
      ),
      v_authoritative_ts
    );
  END IF;

  -- 7. Register Intake Event & Form Submission
  INSERT INTO public.lead_intake_events (
    source, external_event_id, external_lead_id, idempotency_key,
    raw_payload, normalized_payload, status, lead_id, received_at, processed_at
  ) VALUES (
    v_assigned_source, v_form.slug || ':' || p_idempotency_key, p_external_attempt_id, p_idempotency_key,
    p_submitted_data,
    jsonb_build_object(
      'email', v_clean_email,
      'first_name', v_first_name,
      'last_name', v_last_name,
      'phone', p_phone_e164,
      'course_interest', v_clean_course,
      'intent', v_intent
    ),
    'processed', v_target_lead_id, v_authoritative_ts, now()
  ) RETURNING id INTO v_intake_event_id;

  INSERT INTO public.form_submissions (
    form_id, form_name, source, source_detail, course_interest,
    submitted_at, submitted_data, processed_at, lead_id,
    intake_event_id, idempotency_key, email, email_confirmation,
    email_mismatch, phone_e164, processing_status, recovery_state
  ) VALUES (
    v_form.id, v_form.name, v_assigned_source, v_assigned_source_detail, v_clean_course,
    v_authoritative_ts, p_submitted_data, now(), v_target_lead_id,
    v_intake_event_id, p_idempotency_key, v_clean_email, v_clean_email_conf,
    v_email_mismatch, p_phone_e164, 'success', 'none'
  ) RETURNING id INTO v_submission_id;

  RETURN jsonb_build_object(
    'success', true,
    'is_duplicate', false,
    'submission_id', v_submission_id,
    'lead_id', v_target_lead_id,
    'intake_event_id', v_intake_event_id,
    'processing_status', 'success',
    'last_acquisition_at', v_authoritative_ts,
    'success_message', v_form.success_message,
    'redirect_url', v_form.redirect_url
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_form_submission_transaction(TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

-- 3. Update process_hubspot_inbound_batch with Authoritative Timestamp Resolution
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
  v_processed_count INT := 0;
  v_created_count INT := 0;
  v_updated_count INT := 0;
  v_ignored_count INT := 0;
  v_error_count INT := 0;
  v_event JSONB;
  v_props JSONB;
  v_contact_id TEXT;
  v_event_id TEXT;
  v_event_ts TIMESTAMPTZ;
  v_source_created_at TIMESTAMPTZ;
  v_authoritative_ts TIMESTAMPTZ;
  v_payload_hash TEXT;
  v_existing_event RECORD;
  v_email_resolution JSONB;
  v_email TEXT;
  v_email_confirmation TEXT;
  v_email_mismatch BOOLEAN := false;
  v_phone TEXT;
  v_first_name TEXT;
  v_last_name TEXT;
  v_contact_pref TEXT;
  v_raw_course_interest TEXT;
  v_course_interest_val TEXT;
  v_matched_lead_id UUID;
  v_target_lead_id UUID;
  v_capture_stage_id UUID;
  v_existing_lead_course TEXT;
  v_existing_course_interests JSONB;
  v_merged_course_interests JSONB;
  v_intake_event_id UUID;
  v_activity_type TEXT;
  v_activity_summary TEXT;
  v_is_course_info_form BOOLEAN := false;
  v_form_name TEXT;
  v_intent TEXT;
BEGIN
  SELECT id INTO v_capture_stage_id
  FROM public.pipeline_stages
  WHERE code = 'capture'
  LIMIT 1;

  FOR v_event IN SELECT * FROM jsonb_array_elements(p_events) LOOP
    BEGIN
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

      IF v_event->>'occurredAt' IS NOT NULL THEN
        v_event_ts := to_timestamp((v_event->>'occurredAt')::double precision / 1000.0);
      ELSIF v_event->>'timestamp' IS NOT NULL THEN
        v_event_ts := (v_event->>'timestamp')::timestamptz;
      ELSE
        v_event_ts := now();
      END IF;

      v_props := COALESCE(v_event->'properties', '{}'::jsonb);
      IF v_props->>'createdate' IS NOT NULL THEN
        v_source_created_at := public.parse_authoritative_timestamp(v_props->>'createdate');
      ELSE
        v_source_created_at := NULL;
      END IF;

      -- Authoritative Source Timestamp Priority for HubSpot Inbound:
      -- 1. recent_conversion_date
      -- 2. first_conversion_date
      -- 3. hs_analytics_latest_source_timestamp
      -- 4. v_event_ts (occurredAt)
      -- 5. v_source_created_at
      -- 6. now()
      v_authoritative_ts := COALESCE(
        public.parse_authoritative_timestamp(v_props->>'recent_conversion_date'),
        public.parse_authoritative_timestamp(v_props->>'first_conversion_date'),
        public.parse_authoritative_timestamp(v_props->>'hs_analytics_latest_source_timestamp'),
        v_event_ts,
        v_source_created_at,
        now()
      );

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

      v_email_resolution := public.resolve_lead_emails(v_props, 'hubspot');
      v_email := v_email_resolution->>'primary_email';
      v_email_mismatch := COALESCE((v_email_resolution->>'divergence')::boolean, false);

      IF jsonb_array_length(v_email_resolution->'emails') > 1 THEN
        v_email_confirmation := v_email_resolution->'emails'->1->>'normalized_email';
      ELSE
        v_email_confirmation := v_email;
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

      IF v_first_name IS NULL AND v_last_name IS NULL AND v_props->>'hs_full_name_or_email' IS NOT NULL THEN
        v_first_name := trim(v_props->>'hs_full_name_or_email');
      END IF;

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

      -- Resolve Course Interest
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
        ELSIF lower(v_raw_course_interest) LIKE '%rehab%' OR lower(v_raw_course_interest) LIKE '%reabilit%' THEN
          v_course_interest_val := 'Rehabilitation';
        ELSIF lower(v_raw_course_interest) LIKE '%intensiv%' THEN
          v_course_interest_val := 'Intensive Dental Implant Training';
        ELSIF lower(v_raw_course_interest) LIKE '%advanced%' THEN
          v_course_interest_val := 'Advanced Dental Implant Experience';
        ELSE
          v_course_interest_val := v_raw_course_interest;
        END IF;
      END IF;

      v_form_name := COALESCE(v_props->>'recent_conversion_event_name', v_props->>'first_conversion_event_name', v_props->>'form_name', '');
      v_is_course_info_form := (
        lower(v_form_name) LIKE '%course-info-form%' OR
        lower(v_form_name) LIKE '%request course information%' OR
        lower(v_form_name) LIKE '%/contact%'
      );

      IF v_is_course_info_form THEN
        v_intent := 'COURSE_INFORMATION_REQUEST';
        v_activity_summary := 'Solicitou informações sobre ' || COALESCE(v_course_interest_val, 'Curso');
      ELSE
        v_intent := 'GENERAL_CONTACT';
        v_activity_summary := 'Atividade registrada via HubSpot: ' || COALESCE(NULLIF(v_form_name, ''), 'Formulário');
      END IF;

      -- Match existing lead
      v_matched_lead_id := NULL;
      SELECT eds_entity_id INTO v_matched_lead_id
      FROM public.integration_entity_links
      WHERE integration = 'hubspot'
        AND entity_type = 'lead'
        AND external_entity_id = v_contact_id
        AND status = 'active'
      LIMIT 1;

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

      IF v_matched_lead_id IS NULL AND v_phone IS NOT NULL AND v_phone != '' THEN
        SELECT id INTO v_matched_lead_id
        FROM public.leads
        WHERE (phone_e164 = v_phone OR phone_raw = v_phone)
          AND deleted_at IS NULL
        ORDER BY created_at ASC
        LIMIT 1;
      END IF;

      -- Idempotency check against integration_sync_events
      IF EXISTS (
        SELECT 1 FROM public.integration_sync_events
        WHERE integration = 'hubspot'
          AND entity_type = 'contact'
          AND external_entity_id = v_contact_id
          AND (
            (v_event_id IS NOT NULL AND external_event_id = v_event_id)
            OR (payload_hash = v_payload_hash)
          )
      ) THEN
        v_ignored_count := v_ignored_count + 1;
        CONTINUE;
      END IF;

      IF v_matched_lead_id IS NOT NULL THEN
        -- UPDATE EXISTING LEAD:
        -- Strictly preserve original created_at and pipeline stage.
        -- Update last_acquisition_at to authoritative timestamp to resurface card to top of stage.
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

        INSERT INTO public.integration_entity_links (
          integration, entity_type, external_entity_id, eds_entity_id, status, created_at, updated_at
        ) VALUES (
          'hubspot', 'lead', v_contact_id, v_matched_lead_id, 'active', now(), now()
        ) ON CONFLICT (integration, entity_type, external_entity_id) WHERE status = 'active'
        DO UPDATE SET
          eds_entity_id = EXCLUDED.eds_entity_id,
          updated_at = now();

        INSERT INTO public.lead_activities (
          lead_id, activity_type, actor_type, summary, metadata, created_at
        ) VALUES (
          v_matched_lead_id, 'form_submitted', 'system',
          v_activity_summary,
          jsonb_build_object(
            'hubspot_contact_id', v_contact_id,
            'source', 'website',
            'source_detail', 'contact_form',
            'form_name', v_form_name,
            'course', v_course_interest_val,
            'intent', v_intent
          ),
          v_authoritative_ts
        );

        v_updated_count := v_updated_count + 1;
        v_target_lead_id := v_matched_lead_id;
      ELSE
        -- CREATE NEW LEAD
        INSERT INTO public.leads (
          source, source_detail, first_name, last_name, email, email_confirmation,
          email_mismatch, phone_raw, contact_preference, hubspot_contact_id,
          source_created_at, course_interest, course_interests, pipeline_stage_id,
          last_acquisition_at, last_inbound_activity_at, created_at, updated_at
        ) VALUES (
          'website', 'contact_form',
          COALESCE(v_first_name, 'Lead'), v_last_name, v_email, v_email_confirmation,
          v_email_mismatch, v_phone, v_contact_pref, v_contact_id,
          v_source_created_at, v_course_interest_val,
          CASE WHEN v_course_interest_val IS NOT NULL THEN jsonb_build_array(v_course_interest_val) ELSE '[]'::jsonb END,
          v_capture_stage_id,
          v_authoritative_ts, v_authoritative_ts, COALESCE(v_source_created_at, v_authoritative_ts), now()
        ) RETURNING id INTO v_target_lead_id;

        PERFORM public.sync_lead_emails(v_target_lead_id, v_email_resolution->'emails');

        INSERT INTO public.lead_stage_history (
          lead_id, from_stage_id, to_stage_id, change_reason
        ) VALUES (
          v_target_lead_id, NULL, v_capture_stage_id, 'hubspot_initial_sync'
        );

        INSERT INTO public.integration_entity_links (
          integration, entity_type, external_entity_id, eds_entity_id, status, created_at, updated_at
        ) VALUES (
          'hubspot', 'lead', v_contact_id, v_target_lead_id, 'active', now(), now()
        );

        INSERT INTO public.lead_activities (
          lead_id, activity_type, actor_type, summary, metadata, created_at
        ) VALUES (
          v_target_lead_id, 'form_submitted', 'system',
          v_activity_summary,
          jsonb_build_object(
            'hubspot_contact_id', v_contact_id,
            'source', 'website',
            'source_detail', 'contact_form',
            'form_name', v_form_name,
            'course', v_course_interest_val,
            'intent', v_intent
          ),
          v_authoritative_ts
        );

        v_created_count := v_created_count + 1;
      END IF;

      INSERT INTO public.integration_sync_events (
        connection_id, integration, event_type, entity_type, external_entity_id,
        external_event_id, payload, payload_hash, status, created_at
      ) VALUES (
        p_connection_id, 'hubspot', 'contact_inbound', 'contact', v_contact_id,
        v_event_id, v_props, v_payload_hash, 'completed', now()
      );

      v_processed_count := v_processed_count + 1;

    EXCEPTION WHEN OTHERS THEN
      v_error_count := v_error_count + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'total_events', jsonb_array_length(p_events),
    'processed', v_processed_count,
    'created', v_created_count,
    'updated', v_updated_count,
    'ignored', v_ignored_count,
    'errors', v_error_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_hubspot_inbound_batch(JSONB, UUID) TO service_role;

-- 4. Correct Pedro Noe Hernandez (ee80445e-700c-4d24-a4d2-470df37d376e)
-- Set last_acquisition_at strictly to the Authoritative Factual Form Submission Timestamp
-- (2026-10-02 09:33:10.785492+00), correcting the prior processing-time timestamp.
UPDATE public.leads
SET
  last_acquisition_at = '2026-10-02 09:33:10.785492+00',
  last_inbound_activity_at = '2026-10-02 09:33:10.785492+00',
  new_submission_at = '2026-10-02 09:33:10.785492+00',
  updated_at = now()
WHERE id = 'ee80445e-700c-4d24-a4d2-470df37d376e';
