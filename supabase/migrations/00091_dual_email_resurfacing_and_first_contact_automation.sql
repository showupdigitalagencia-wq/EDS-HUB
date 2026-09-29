-- Migration 00091: Dual-Email Preservation, Lead Resurfacing Parity & Automation Support
-- 
-- 1. Schema Extensions:
--    - public.leads.email_mismatch BOOLEAN DEFAULT false
--    - public.form_submissions.email_confirmation TEXT
--    - public.form_submissions.email_mismatch BOOLEAN DEFAULT false
--
-- 2. Updates process_form_submission_transaction:
--    - Preserves email and email_confirmation independently
--    - Detects and flags email_mismatch = true when distinct
--    - On Returning Lead: updates last_inbound_activity_at = now(), preserves created_at & stage
--    - Stores email_confirmation and email_mismatch in form_submissions and submitted_data
--
-- 3. Updates process_hubspot_inbound_batch:
--    - Preserves email and email_confirmation independently from HubSpot properties
--    - Sets email_mismatch = true on discrepancy
--    - Preserves returning leads without resetting created_at or altering pipeline stage
--    - Returns created_leads array for real-time first-contact automation handoff
--
-- 4. Updates get_lead_form_submissions:
--    - Maps email_confirmation to 'Confirmação de e-mail'
--    - Maps email_mismatch to 'Divergência de E-mail' (Detectada / Não detectada)

-- 1. Schema Extensions
ALTER TABLE public.leads 
  ADD COLUMN IF NOT EXISTS email_mismatch BOOLEAN DEFAULT false;

ALTER TABLE public.form_submissions 
  ADD COLUMN IF NOT EXISTS email_confirmation TEXT;

ALTER TABLE public.form_submissions 
  ADD COLUMN IF NOT EXISTS email_mismatch BOOLEAN DEFAULT false;

-- 2. Update process_form_submission_transaction
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
  v_resolved_course_id UUID;
  v_resolved_incomplete_count INT := 0;
BEGIN
  -- 1. Fetch Form
  SELECT id, slug, name, current_version, status, default_pipeline_stage_id,
         success_message, redirect_url, source_detail
  INTO v_form
  FROM public.forms
  WHERE slug = p_form_slug;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Form not found',
      'error_code', 'FORM_NOT_FOUND'
    );
  END IF;

  IF v_form.status != 'active' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Form is inactive',
      'error_code', 'FORM_INACTIVE'
    );
  END IF;

  -- 2. Check Idempotency Key (scoped to form_id)
  SELECT id, lead_id, intake_event_id, processing_status, processing_error
  INTO v_existing_sub
  FROM public.form_submissions
  WHERE form_id = v_form.id AND idempotency_key = p_idempotency_key;

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

  -- 3. Lead Deduplication Search (email and phone)
  v_clean_email := NULLIF(lower(trim(COALESCE(p_email, ''))), '');
  IF v_clean_email IS NOT NULL THEN
    SELECT id INTO v_lead_by_email
    FROM public.leads
    WHERE email = v_clean_email
      AND deleted_at IS NULL
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF p_phone_e164 IS NOT NULL AND trim(p_phone_e164) != '' THEN
    SELECT id INTO v_lead_by_phone
    FROM public.leads
    WHERE phone_e164 = trim(p_phone_e164)
      AND deleted_at IS NULL
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  -- 4. Identity Conflict Protection
  IF v_lead_by_email IS NOT NULL AND v_lead_by_phone IS NOT NULL AND v_lead_by_email != v_lead_by_phone THEN
    INSERT INTO public.form_submissions (
      form_id, form_version, form_name, source, lead_id, intake_event_id, submitted_data,
      email, phone_e164, contact_preference, course_interest,
      source_detail, processing_status, processing_error,
      idempotency_key, ip_address, user_agent, submitted_at, processed_at
    ) VALUES (
      v_form.id, v_form.current_version, v_form.name, 'website', NULL, NULL, p_submitted_data,
      v_clean_email, p_phone_e164, p_contact_preference, p_course_interest,
      v_form.source_detail, 'conflict', 'Conflict: email and phone belong to different leads.',
      p_idempotency_key, p_ip_address, p_user_agent, now(), now()
    ) RETURNING id INTO v_submission_id;

    RETURN jsonb_build_object(
      'success', true,
      'is_duplicate', false,
      'submission_id', v_submission_id,
      'lead_id', NULL,
      'intake_event_id', NULL,
      'processing_status', 'conflict',
      'success_message', v_form.success_message,
      'redirect_url', v_form.redirect_url
    );
  END IF;

  -- 5. Resolve target lead
  v_target_lead_id := COALESCE(v_lead_by_email, v_lead_by_phone);
  v_first_name := NULLIF(trim(COALESCE(p_submitted_data->>'first_name', '')), '');
  v_last_name := NULLIF(trim(COALESCE(p_submitted_data->>'last_name', '')), '');

  IF v_first_name IS NULL AND p_submitted_data->>'name' IS NOT NULL THEN
    DECLARE
      v_full_name TEXT := trim(p_submitted_data->>'name');
      v_space_pos INT := position(' ' IN v_full_name);
    BEGIN
      IF v_space_pos > 0 THEN
        v_first_name := substring(v_full_name FROM 1 FOR v_space_pos - 1);
        v_last_name := trim(substring(v_full_name FROM v_space_pos + 1));
      ELSE
        v_first_name := v_full_name;
      END IF;
    END;
  END IF;

  v_clean_phone_raw := NULLIF(trim(COALESCE(p_submitted_data->>'phone', '')), '');
  v_clean_course := NULLIF(trim(COALESCE(p_course_interest, '')), '');
  
  -- Dual-Email Extraction & Mismatch Detection
  v_clean_email_conf := NULLIF(lower(trim(COALESCE(
    p_submitted_data->>'email_confirmation',
    p_submitted_data->>'confirm_email',
    p_submitted_data->>'confirmation_email',
    p_submitted_data->>'confirm_your_email',
    p_submitted_data->>'confirmar_email',
    ''
  ))), '');

  IF v_clean_email IS NOT NULL AND v_clean_email_conf IS NOT NULL AND v_clean_email != v_clean_email_conf THEN
    v_email_mismatch := true;
  END IF;

  -- Relaxed contact_preference
  v_pref := NULLIF(trim(lower(COALESCE(p_contact_preference, ''))), '');
  IF v_pref NOT IN ('email', 'sms', 'call', 'whatsapp') THEN
    v_pref := NULL;
  END IF;

  IF v_target_lead_id IS NULL THEN
    -- NEW LEAD: Create in default stage with initial activity timestamp and dual email preservation
    INSERT INTO public.leads (
      source, source_detail, first_name, last_name, email, email_confirmation, email_mismatch,
      phone_raw, phone_e164, contact_preference, course_interest,
      course_interests, pipeline_stage_id, last_inbound_activity_at,
      has_new_submission, new_submission_at, created_at, updated_at
    ) VALUES (
      'form', 'website', v_first_name, v_last_name, v_clean_email, COALESCE(v_clean_email_conf, v_clean_email), v_email_mismatch,
      v_clean_phone_raw, p_phone_e164,
      v_pref, v_clean_course,
      CASE WHEN v_clean_course IS NOT NULL 
           THEN jsonb_build_array(v_clean_course) 
           ELSE '[]'::jsonb END,
      v_form.default_pipeline_stage_id, now(),
      false, NULL, now(), now()
    ) RETURNING id INTO v_target_lead_id;

    -- Stage history assignment
    INSERT INTO public.lead_stage_history (
      lead_id, from_stage_id, to_stage_id, change_reason
    ) VALUES (
      v_target_lead_id, NULL, v_form.default_pipeline_stage_id, 'initial_assignment'
    );

    -- Activity: lead_created
    INSERT INTO public.lead_activities (
      lead_id, activity_type, actor_type, summary, metadata
    ) VALUES (
      v_target_lead_id, 'lead_created', 'system',
      'Lead created from form: ' || v_form.name,
      jsonb_build_object(
        'source', 'form',
        'form_id', v_form.id,
        'form_slug', v_form.slug,
        'source_detail', 'website'
      )
    );
  ELSE
    -- RETURNING LEAD: Update non-destructively, deduplicate courses, and resurface to top of stage
    SELECT course_interest, course_interests
    INTO v_existing_course_interest, v_existing_course_interests
    FROM public.leads
    WHERE id = v_target_lead_id;

    v_merged_course_interests := COALESCE(v_existing_course_interests, '[]'::jsonb);
    v_merged_course_interest := v_existing_course_interest;

    IF v_clean_course IS NOT NULL THEN
      -- Check canonical identity match against existing interests
      IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(v_merged_course_interests) AS elem
        WHERE lower(trim(elem)) = lower(v_clean_course)
           OR (lower(v_clean_course) = 'zygomatic' AND lower(trim(elem)) LIKE '%zygoma%')
           OR (lower(v_clean_course) LIKE '%zygoma%' AND lower(trim(elem)) = 'zygomatic')
           OR (lower(v_clean_course) = 'wisdom' AND lower(trim(elem)) LIKE '%wisdom%')
           OR (lower(v_clean_course) LIKE '%wisdom%' AND lower(trim(elem)) = 'wisdom')
           OR (lower(v_clean_course) = 'endodontic' AND lower(trim(elem)) LIKE '%endo%')
           OR (lower(v_clean_course) = 'endodontics' AND lower(trim(elem)) LIKE '%endo%')
           OR (lower(v_clean_course) LIKE '%endo%' AND (lower(trim(elem)) = 'endodontic' OR lower(trim(elem)) = 'endodontics'))
           OR (lower(v_clean_course) = 'periodontal' AND lower(trim(elem)) LIKE '%perio%')
           OR (lower(v_clean_course) = 'periodontal plastic' AND lower(trim(elem)) LIKE '%perio%')
           OR (lower(v_clean_course) LIKE '%perio%' AND (lower(trim(elem)) = 'periodontal' OR lower(trim(elem)) = 'periodontal plastic'))
           OR (lower(v_clean_course) = 'rehabilitation' AND lower(trim(elem)) LIKE '%rehab%')
           OR (lower(v_clean_course) LIKE '%rehab%' AND lower(trim(elem)) = 'rehabilitation')
      ) THEN
        v_merged_course_interests := v_merged_course_interests || jsonb_build_array(v_clean_course);
        IF v_merged_course_interest IS NULL OR trim(v_merged_course_interest) = '' THEN
          v_merged_course_interest := v_clean_course;
        ELSE
          v_merged_course_interest := v_merged_course_interest || ', ' || v_clean_course;
        END IF;
      END IF;
    END IF;

    -- Update lead: Preserves original created_at and pipeline_stage_id! Resurfaces via last_inbound_activity_at!
    UPDATE public.leads
    SET
      first_name = COALESCE(v_first_name, first_name),
      last_name = COALESCE(v_last_name, last_name),
      phone_raw = COALESCE(v_clean_phone_raw, phone_raw),
      phone_e164 = COALESCE(p_phone_e164, phone_e164),
      contact_preference = COALESCE(v_pref, contact_preference),
      email_confirmation = COALESCE(v_clean_email_conf, email_confirmation),
      email_mismatch = (v_email_mismatch OR COALESCE(email_mismatch, false)),
      course_interest = v_merged_course_interest,
      course_interests = v_merged_course_interests,
      last_inbound_activity_at = now(),
      has_new_submission = true,
      new_submission_at = now(),
      updated_at = now()
    WHERE id = v_target_lead_id;

    -- Activity: returning_lead_form_submitted
    INSERT INTO public.lead_activities (
      lead_id, activity_type, actor_type, summary, metadata
    ) VALUES (
      v_target_lead_id, 'form_submitted', 'system',
      'Lead retornou com novo formulário do site: ' || v_form.name,
      jsonb_build_object(
        'source', 'form',
        'form_id', v_form.id,
        'form_slug', v_form.slug,
        'source_detail', 'website',
        'is_returning_lead', true,
        'new_course_interest', v_clean_course
      )
    );
  END IF;

  -- 6. Course Interest Relational Linking (lead_course_interests)
  IF v_clean_course IS NOT NULL THEN
    SELECT id INTO v_resolved_course_id
    FROM public.courses
    WHERE lower(name) = lower(v_clean_course)
       OR lower(code) = lower(v_clean_course)
       OR lower(name) LIKE '%' || lower(v_clean_course) || '%'
       OR lower(v_clean_course) LIKE '%' || lower(code) || '%'
    LIMIT 1;

    IF v_resolved_course_id IS NOT NULL THEN
      DECLARE
        v_slot INT := NULL;
      BEGIN
        SELECT slot INTO v_slot
        FROM unnest(ARRAY[1, 2, 3]) AS slot
        WHERE slot NOT IN (
          SELECT priority FROM public.lead_course_interests
          WHERE lead_id = v_target_lead_id AND priority IS NOT NULL
        )
        ORDER BY slot ASC
        LIMIT 1;

        INSERT INTO public.lead_course_interests (lead_id, course_id, priority, source, status, created_at, updated_at)
        VALUES (v_target_lead_id, v_resolved_course_id, v_slot, 'form', 'active', now(), now())
        ON CONFLICT (lead_id, course_id) DO NOTHING;
      END;
    END IF;
  END IF;

  -- 7. Insert lead_intake_events record
  INSERT INTO public.lead_intake_events (
    source, external_event_id, external_lead_id, idempotency_key,
    raw_payload, normalized_payload, status, lead_id, attempt_count, received_at
  ) VALUES (
    'form', p_idempotency_key, v_target_lead_id::text,
    'form:' || v_form.id::text || ':' || p_idempotency_key,
    p_submitted_data,
    jsonb_build_object(
      'form_slug', v_form.slug,
      'email', v_clean_email,
      'email_confirmation', v_clean_email_conf,
      'email_mismatch', v_email_mismatch,
      'phone', p_phone_e164,
      'first_name', v_first_name,
      'last_name', v_last_name,
      'contact_preference', v_pref,
      'course_interest', v_clean_course,
      'source_detail', 'website'
    ),
    'processed', v_target_lead_id, 1, now()
  ) RETURNING id INTO v_intake_event_id;

  -- 8. Persist form_submissions record with full factual fields
  INSERT INTO public.form_submissions (
    form_id, form_version, form_name, source, lead_id, intake_event_id, submitted_data,
    email, email_confirmation, email_mismatch, phone_e164, contact_preference, course_interest,
    source_detail, processing_status, idempotency_key,
    ip_address, user_agent, submitted_at, processed_at
  ) VALUES (
    v_form.id, v_form.current_version, v_form.name, 'website', v_target_lead_id, v_intake_event_id,
    p_submitted_data || jsonb_build_object(
      'email_confirmation', COALESCE(v_clean_email_conf, v_clean_email),
      'email_mismatch', v_email_mismatch
    ),
    v_clean_email, v_clean_email_conf, v_email_mismatch, p_phone_e164, v_pref, v_clean_course,
    'website', 'processed', p_idempotency_key,
    p_ip_address, p_user_agent, now(), now()
  ) RETURNING id INTO v_submission_id;

  -- 9. Resolve any active incomplete enrollments and follow-up tasks for this lead upon successful completion
  BEGIN
    WITH resolved AS (
      UPDATE public.incomplete_enrollments
      SET status = 'completed',
          resolved_at = now(),
          updated_at = now()
      WHERE lead_id = v_target_lead_id
        AND (status IS NULL OR status IN ('needs_followup', 'submission_failed'))
      RETURNING id
    )
    SELECT count(*) INTO v_resolved_incomplete_count FROM resolved;

    UPDATE public.tasks
    SET status = 'completed',
        updated_at = now()
    WHERE lead_id = v_target_lead_id
      AND status = 'pending'
      AND (task_source = 'incomplete_enrollment' OR title ILIKE '%inscrição%' OR title ILIKE '%inscricao%');

    IF v_resolved_incomplete_count > 0 THEN
      INSERT INTO public.lead_activities (
        lead_id, activity_type, actor_type, summary, metadata
      ) VALUES (
        v_target_lead_id, 'incomplete_enrollment_recovered', 'system',
        'Inscrição finalizada com sucesso após tentativa anterior.',
        jsonb_build_object(
          'form_id', v_form.id,
          'form_slug', v_form.slug,
          'source_detail', 'website',
          'resolved_attempts_count', v_resolved_incomplete_count
        )
      );
    END IF;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'is_duplicate', false,
    'submission_id', v_submission_id,
    'lead_id', v_target_lead_id,
    'intake_event_id', v_intake_event_id,
    'processing_status', 'processed',
    'success_message', v_form.success_message,
    'redirect_url', v_form.redirect_url
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_form_submission_transaction TO service_role;

-- 3. Update process_hubspot_inbound_batch
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

      -- Source created_at detection
      v_props := COALESCE(v_event->'properties', '{}'::jsonb);
      IF v_props->>'createdate' IS NOT NULL THEN
        BEGIN
          IF v_props->>'createdate' ~ '^\d+$' THEN
            v_source_created_at := to_timestamp((v_props->>'createdate')::double precision / 1000.0);
          ELSE
            v_source_created_at := (v_props->>'createdate')::timestamptz;
          END IF;
        EXCEPTION WHEN OTHERS THEN
          v_source_created_at := v_event_ts;
        END;
      ELSE
        v_source_created_at := v_event_ts;
      END IF;

      -- Merge top-level fields into properties if not present
      v_props := v_props || jsonb_build_object(
        'firstname', COALESCE(v_props->>'firstname', v_event->>'firstname'),
        'lastname', COALESCE(v_props->>'lastname', v_event->>'lastname'),
        'email', COALESCE(v_props->>'email', v_event->>'email'),
        'phone', COALESCE(v_props->>'phone', v_event->>'phone')
      );

      v_payload_hash := md5(v_props::text);

      -- Normalize core identity fields
      v_email := NULLIF(lower(trim(COALESCE(v_props->>'email', v_event->>'email', ''))), '');
      v_email_confirmation := NULLIF(lower(trim(COALESCE(
        v_props->>'email_confirmation',
        v_props->>'confirm_email',
        v_props->>'confirmation_email',
        v_props->>'confirm_your_email',
        v_props->>'confirmar_email',
        v_event->>'email_confirmation',
        ''
      ))), '');

      IF v_email IS NOT NULL AND v_email_confirmation IS NOT NULL AND v_email != v_email_confirmation THEN
        v_email_mismatch := true;
      ELSE
        v_email_mismatch := false;
      END IF;

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
          email_confirmation = COALESCE(v_email_confirmation, email_confirmation),
          email_mismatch = (v_email_mismatch OR COALESCE(email_mismatch, false)),
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
          v_source_created_at, v_source_created_at, now()
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
            'course', v_course_interest_val
          )
        );

        -- Accumulate created lead for real-time automation handoff
        v_created_leads := v_created_leads || jsonb_build_array(jsonb_build_object(
          'lead_id', v_matched_lead_id,
          'email', v_email,
          'email_confirmation', v_email_confirmation,
          'phone', v_phone,
          'first_name', v_first_name,
          'last_name', v_last_name,
          'contact_preference', v_contact_pref,
          'course_interest', v_course_interest_val,
          'source', v_source,
          'source_detail', v_source_detail,
          'created_at', v_source_created_at
        ));

        v_created_count := v_created_count + 1;
      END IF;

      -- Relational Course Interest linking
      IF v_resolved_course_id IS NOT NULL THEN
        INSERT INTO public.lead_course_interests (
          lead_id, course_id, priority, source, status, created_at, updated_at
        ) VALUES (
          v_matched_lead_id, v_resolved_course_id, 1, 'hubspot', 'active', now(), now()
        ) ON CONFLICT (lead_id, course_id) DO NOTHING;
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

-- 4. Update get_lead_form_submissions
CREATE OR REPLACE FUNCTION public.get_lead_form_submissions(p_lead_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_results JSONB := '[]'::JSONB;
  v_rec RECORD;
  v_fields JSONB;
  v_source_label TEXT;
  v_source_raw TEXT;
  v_form_title TEXT;
  v_submitted_at TIMESTAMPTZ;
  v_raw JSONB;
  v_payload JSONB;
  v_key TEXT;
  v_val TEXT;
  v_label TEXT;
  v_lead RECORD;
  v_seen_sub_ids TEXT[] := ARRAY[]::TEXT[];
  v_sync_via TEXT;
  v_recovery_state TEXT;
  v_notes TEXT;
  v_prohibited CONSTANT TEXT[] := ARRAY[
    'medical_conditions', 'medical_condition', 'dietary', 'dietary_restrictions',
    'allergies', 'allergy', 'passport', 'passport_number', 'passport_file',
    'dental_license_file', 'license_file', 'emergency_phone', 'emergency_contact',
    'signature', 'password', 'payment', 'credit_card', 'card_number', 'cvv',
    'token', 'secret', 'csrf', 'session_id', 'cookie', 'raw_form_data', 'raw_data',
    'api_key', 'access_token', 'headers', 'authorization'
  ];
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: active app user required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id;
  IF NOT FOUND THEN
    RETURN '[]'::JSONB;
  END IF;

  -- 1. Form Submissions (Canonical form_submissions table)
  FOR v_rec IN (
    SELECT fs.id, fs.form_id, fs.form_name, fs.source, fs.source_detail,
           fs.submitted_data, fs.submitted_at, fs.course_interest, fs.email,
           fs.phone_e164, fs.contact_preference, fs.recovery_state, fs.notes,
           f.name AS catalog_form_name, f.slug AS catalog_form_slug
    FROM public.form_submissions fs
    LEFT JOIN public.forms f ON f.id = fs.form_id
    WHERE fs.lead_id = p_lead_id
    ORDER BY fs.submitted_at DESC
  ) LOOP
    v_source_raw := COALESCE(v_rec.source, v_rec.source_detail, 'form');
    
    -- Format Factual Source Label
    IF lower(v_source_raw) LIKE '%instagram%' THEN
      v_source_label := 'Instagram Lead Ads';
    ELSIF lower(v_source_raw) LIKE '%facebook%' THEN
      v_source_label := 'Facebook Lead Ads';
    ELSIF lower(v_source_raw) LIKE '%meta%' THEN
      v_source_label := 'Meta Lead Ads';
    ELSIF lower(v_source_raw) LIKE '%website%' OR lower(v_source_raw) = 'form' OR lower(v_source_raw) = 'site' THEN
      v_source_label := 'Site';
    ELSIF lower(v_source_raw) LIKE '%hubspot%' THEN
      v_source_label := 'HubSpot';
    ELSE
      v_source_label := COALESCE(v_rec.source, 'Site');
    END IF;

    v_form_title := COALESCE(
      v_rec.form_name,
      v_rec.catalog_form_name,
      v_rec.catalog_form_slug,
      v_rec.course_interest,
      'Formulário de Inscrição'
    );
    v_submitted_at := v_rec.submitted_at;
    v_fields := '[]'::JSONB;
    v_sync_via := NULL;
    v_recovery_state := COALESCE(v_rec.recovery_state, 'complete');
    v_notes := v_rec.notes;

    -- Dynamically iterate over submitted_data keys
    IF v_rec.submitted_data IS NOT NULL AND jsonb_typeof(v_rec.submitted_data) = 'object' THEN
      FOR v_key, v_val IN SELECT key, value#>>'{}' FROM jsonb_each(v_rec.submitted_data) LOOP
        -- Skip prohibited / sensitive keys
        IF lower(v_key) = ANY(v_prohibited) OR lower(v_key) LIKE '%password%' OR lower(v_key) LIKE '%token%' OR lower(v_key) LIKE '%secret%' THEN
          CONTINUE;
        END IF;

        IF v_val IS NOT NULL AND trim(v_val) != '' THEN
          IF lower(v_key) = 'synchronized_via' THEN
            v_sync_via := trim(v_val);
          END IF;

          CASE lower(v_key)
            WHEN 'first_name', 'firstname' THEN v_label := 'Nome';
            WHEN 'last_name', 'lastname' THEN v_label := 'Sobrenome';
            WHEN 'full_name', 'name' THEN v_label := 'Nome completo';
            WHEN 'email' THEN v_label := 'E-mail';
            WHEN 'confirm_your_email', 'confirm_email', 'please_confirm_your_email_address', 'email_confirmation', 'confirmation_email', 'confirmar_email' THEN v_label := 'Confirmação de e-mail';
            WHEN 'email_mismatch' THEN 
              v_label := 'Divergência de E-mail';
              IF lower(trim(v_val)) = 'true' THEN
                v_val := 'Detectada (E-mails diferentes)';
              ELSE
                v_val := 'Não detectada (E-mails iguais)';
              END IF;
            WHEN 'phone', 'phone_number', 'phone_raw', 'mobilephone' THEN v_label := 'Telefone';
            WHEN 'contact_preference', 'preferred_contact_method', 'preferencia_de_contato' THEN v_label := 'Preferência de contato';
            WHEN 'what_is_your_preferred_contact_method' THEN v_label := 'Método de contato de preferência';
            WHEN 'what_is_your_preferred_method_of_contact' THEN v_label := 'Método de contato preferido';
            WHEN 'what_is_your_current_license_status' THEN v_label := 'Status de licença profissional';
            WHEN 'when_would_you_like_to_attend_our_intensive_course' THEN v_label := 'Previsão de participação no curso';
            WHEN 'education_level' THEN v_label := 'Nível de escolaridade';
            WHEN 'course', 'course_interest', 'curso_de_interesse' THEN v_label := 'Curso de interesse';
            WHEN 'curso_de_interesse_2' THEN v_label := 'Segundo curso de interesse';
            WHEN 'curso_de_interesse_3' THEN v_label := 'Terceiro curso de interesse';
            WHEN 'course_session', 'session', 'data_do_curso', 'data_do_curso_de_interesse' THEN v_label := 'Data / Turma do curso';
            WHEN 'specialty', 'speciality', 'especialidade' THEN v_label := 'Especialidade';
            WHEN 'years_in_practice', 'tempo_de_formado' THEN v_label := 'Anos de prática';
            WHEN 'surgical_experience', 'experiencia_cirurgica' THEN v_label := 'Experiência cirúrgica';
            WHEN 'agd_number', 'numero_agd' THEN v_label := 'Número AGD';
            WHEN 'heard_from', 'como_conheceu' THEN v_label := 'Como soube de nós';
            WHEN 'referral_name', 'indicado_por' THEN v_label := 'Indicado por';
            WHEN 'promo_code', 'cupom' THEN v_label := 'Código promocional';
            WHEN 'terms_accepted' THEN v_label := 'Termos aceitos';
            WHEN 'source_page', 'page_url' THEN v_label := 'Página de origem';
            WHEN 'utm_source' THEN v_label := 'UTM Source';
            WHEN 'utm_medium' THEN v_label := 'UTM Medium';
            WHEN 'utm_campaign', 'campaign', 'campaign_name' THEN v_label := 'Campanha';
            WHEN 'ad_name', 'anuncio' THEN v_label := 'Anúncio';
            WHEN 'utm_content' THEN v_label := 'UTM Content';
            WHEN 'utm_term' THEN v_label := 'UTM Term';
            WHEN 'source_platform', 'origem_do_lead' THEN v_label := 'Plataforma de origem';
            WHEN 'synchronized_via' THEN v_label := 'Sincronizado via';
            WHEN 'message', 'mensagem' THEN v_label := 'Mensagem';
            WHEN 'city', 'cidade' THEN v_label := 'Cidade';
            WHEN 'state', 'estado' THEN v_label := 'Estado';
            WHEN 'country', 'pais', 'ip_country' THEN v_label := 'País';
            ELSE
              v_label := initcap(replace(v_key, '_', ' '));
          END CASE;

          v_fields := v_fields || jsonb_build_object('label', v_label, 'value', trim(v_val));
        END IF;
      END LOOP;
    END IF;

    -- Fallback row fields if empty
    IF jsonb_array_length(v_fields) = 0 THEN
      IF v_rec.email IS NOT NULL THEN
        v_fields := v_fields || jsonb_build_object('label', 'E-mail', 'value', v_rec.email);
      END IF;
      IF v_rec.phone_e164 IS NOT NULL THEN
        v_fields := v_fields || jsonb_build_object('label', 'Telefone', 'value', v_rec.phone_e164);
      END IF;
      IF v_rec.course_interest IS NOT NULL THEN
        v_fields := v_fields || jsonb_build_object('label', 'Curso de interesse', 'value', v_rec.course_interest);
      END IF;
      IF v_rec.contact_preference IS NOT NULL THEN
        v_fields := v_fields || jsonb_build_object('label', 'Preferência de contato', 'value', v_rec.contact_preference);
      END IF;
    END IF;

    v_seen_sub_ids := array_append(v_seen_sub_ids, v_rec.id::text);

    v_results := v_results || jsonb_build_object(
      'id', v_rec.id,
      'source', v_source_label,
      'source_raw', v_source_raw,
      'form_name', v_form_title,
      'submitted_at', v_submitted_at,
      'recovery_state', v_recovery_state,
      'notes', v_notes,
      'synchronized_via', v_sync_via,
      'fields', v_fields
    );
  END LOOP;

  -- 2. Fallback to lead_intake_events if no form_submissions recorded
  IF jsonb_array_length(v_results) = 0 THEN
    FOR v_rec IN (
      SELECT id, source, received_at, normalized_payload, raw_payload
      FROM public.lead_intake_events
      WHERE lead_id = p_lead_id
      ORDER BY received_at DESC
    ) LOOP
      v_raw := COALESCE(v_rec.raw_payload, '{}'::JSONB);
      v_payload := COALESCE(v_rec.normalized_payload, '{}'::JSONB);
      v_fields := '[]'::JSONB;

      -- Source
      IF v_rec.source = 'meta' THEN
        v_source_label := 'Meta Lead Ads';
      ELSIF v_rec.source = 'form' THEN
        v_source_label := 'Site';
      ELSIF v_rec.source = 'hubspot' THEN
        v_source_label := 'HubSpot';
      ELSE
        v_source_label := initcap(v_rec.source);
      END IF;

      v_form_title := COALESCE(
        v_payload->>'form_name',
        v_raw->>'first_conversion_event_name',
        v_payload->>'course_interest',
        'Inscrição Direta'
      );

      IF v_payload->>'first_name' IS NOT NULL THEN
        v_fields := v_fields || jsonb_build_object('label', 'Nome', 'value', v_payload->>'first_name');
      END IF;
      IF v_payload->>'last_name' IS NOT NULL THEN
        v_fields := v_fields || jsonb_build_object('label', 'Sobrenome', 'value', v_payload->>'last_name');
      END IF;
      IF v_payload->>'email' IS NOT NULL THEN
        v_fields := v_fields || jsonb_build_object('label', 'E-mail', 'value', v_payload->>'email');
      END IF;
      IF v_payload->>'email_confirmation' IS NOT NULL THEN
        v_fields := v_fields || jsonb_build_object('label', 'Confirmação de e-mail', 'value', v_payload->>'email_confirmation');
      END IF;
      IF (v_payload->>'email_mismatch')::boolean IS TRUE THEN
        v_fields := v_fields || jsonb_build_object('label', 'Divergência de E-mail', 'value', 'Detectada (E-mails diferentes)');
      END IF;
      IF v_payload->>'phone' IS NOT NULL THEN
        v_fields := v_fields || jsonb_build_object('label', 'Telefone', 'value', v_payload->>'phone');
      END IF;
      IF v_payload->>'course_interest' IS NOT NULL THEN
        v_fields := v_fields || jsonb_build_object('label', 'Curso de interesse', 'value', v_payload->>'course_interest');
      END IF;
      IF v_payload->>'contact_preference' IS NOT NULL THEN
        v_fields := v_fields || jsonb_build_object('label', 'Preferência de contato', 'value', v_payload->>'contact_preference');
      END IF;

      v_results := v_results || jsonb_build_object(
        'id', v_rec.id,
        'source', v_source_label,
        'source_raw', v_rec.source,
        'form_name', v_form_title,
        'submitted_at', v_rec.received_at,
        'recovery_state', 'complete',
        'notes', NULL,
        'synchronized_via', NULL,
        'fields', v_fields
      );
    END LOOP;
  END IF;

  RETURN v_results;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_lead_form_submissions(UUID) TO authenticated, service_role, anon;
