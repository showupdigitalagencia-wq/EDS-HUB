-- Migration 00080: Fix form_submissions processing_status check constraint and RPC values
-- =============================================================================

-- 1. Relax/extend form_submissions_processing_status_check constraint
ALTER TABLE public.form_submissions 
  DROP CONSTRAINT IF EXISTS form_submissions_processing_status_check;

ALTER TABLE public.form_submissions 
  ADD CONSTRAINT form_submissions_processing_status_check 
  CHECK (processing_status = ANY (ARRAY[
    'received'::text,
    'processing'::text,
    'processed'::text,
    'completed'::text,
    'success'::text,
    'conflict'::text,
    'failed'::text,
    'historical_backfill'::text
  ]));

-- 2. Update process_form_submission_transaction with 'processed' status, form_name, and source
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
  
  -- Relaxed contact_preference
  v_pref := NULLIF(trim(lower(COALESCE(p_contact_preference, ''))), '');
  IF v_pref NOT IN ('email', 'sms', 'call', 'whatsapp') THEN
    v_pref := NULL;
  END IF;

  IF v_target_lead_id IS NULL THEN
    -- NEW LEAD: Create in default stage with initial activity timestamp
    INSERT INTO public.leads (
      source, source_detail, first_name, last_name, email, email_confirmation,
      phone_raw, phone_e164, contact_preference, course_interest,
      course_interests, pipeline_stage_id, last_inbound_activity_at,
      has_new_submission, new_submission_at, created_at, updated_at
    ) VALUES (
      'form', 'website', v_first_name, v_last_name, v_clean_email, v_clean_email,
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
      INSERT INTO public.lead_course_interests (lead_id, course_id, source, status)
      VALUES (v_target_lead_id, v_resolved_course_id, 'form', 'active')
      ON CONFLICT DO NOTHING;
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
    email, phone_e164, contact_preference, course_interest,
    source_detail, processing_status, idempotency_key,
    ip_address, user_agent, submitted_at, processed_at
  ) VALUES (
    v_form.id, v_form.current_version, v_form.name, 'website', v_target_lead_id, v_intake_event_id, p_submitted_data,
    v_clean_email, p_phone_e164, v_pref, v_clean_course,
    'website', 'processed', p_idempotency_key,
    p_ip_address, p_user_agent, now(), now()
  ) RETURNING id INTO v_submission_id;

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

-- 3. Update process_hubspot_inbound_batch with 'processed' status
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
BEGIN
  FOR v_event IN SELECT * FROM jsonb_array_elements(p_events)
  LOOP
    BEGIN
      v_event_id := v_event->>'id';
      v_contact_id := v_event->>'contact_id';
      v_props := COALESCE(v_event->'properties', '{}'::jsonb);
      v_event_ts := COALESCE((v_event->>'timestamp')::timestamptz, now());

      IF v_contact_id IS NULL OR trim(v_contact_id) = '' THEN
        v_ignored_count := v_ignored_count + 1;
        CONTINUE;
      END IF;

      -- Normalize core identity fields
      v_email := NULLIF(lower(trim(COALESCE(v_props->>'email', ''))), '');
      v_phone := NULLIF(regexp_replace(COALESCE(v_props->>'phone', v_props->>'mobilephone', ''), '\D', '', 'g'), '');
      v_first_name := NULLIF(trim(COALESCE(v_props->>'firstname', '')), '');
      v_last_name := NULLIF(trim(COALESCE(v_props->>'lastname', '')), '');
      
      -- Course interest detection
      v_raw_course_interest := COALESCE(
        v_props->>'curso_de_interesse',
        v_props->>'course_interest',
        v_props->>'qual_o_seu_interesse_',
        v_props->>'qual_o_seu_interesse'
      );
      v_course_interest_val := NULLIF(trim(COALESCE(v_raw_course_interest, '')), '');

      v_contact_pref := NULLIF(trim(lower(COALESCE(
        v_props->>'what_is_your_preferred_contact_method',
        v_props->>'what_is_your_preferred_method_of_contact',
        v_props->>'preferencia_de_contato',
        ''
      ))), '');

      IF v_contact_pref IN ('whats', 'zap', 'whatsapp') THEN
        v_contact_pref := 'whatsapp';
      ELSIF v_contact_pref IN ('email', 'e-mail') THEN
        v_contact_pref := 'email';
      ELSIF v_contact_pref IN ('sms', 'text') THEN
        v_contact_pref := 'sms';
      ELSIF v_contact_pref IN ('phone', 'call', 'ligacao', 'telefone') THEN
        v_contact_pref := 'call';
      ELSE
        v_contact_pref := NULL;
      END IF;

      -- Source attribution
      IF lower(COALESCE(v_props->>'origem_do_lead', '')) LIKE '%meta%' OR
         lower(COALESCE(v_props->>'origem_do_lead', '')) LIKE '%facebook%' OR
         lower(COALESCE(v_props->>'origem_do_lead', '')) LIKE '%instagram%' OR
         lower(COALESCE(v_props->>'hs_analytics_source', '')) = 'paid_social' THEN
        v_source := 'meta';
        v_source_detail := 'meta_lead_ad';
      ELSIF lower(COALESCE(v_props->>'origem_do_lead', '')) LIKE '%site%' OR
            lower(COALESCE(v_props->>'origem_do_lead', '')) LIKE '%website%' OR
            lower(COALESCE(v_props->>'hs_analytics_source', '')) = 'organic_search' OR
            lower(COALESCE(v_props->>'hs_analytics_source', '')) = 'direct_traffic' THEN
        v_source := 'form';
        v_source_detail := 'website';
      ELSE
        v_source := 'hubspot';
        v_source_detail := 'hubspot_sync';
      END IF;

      v_is_form_submission := (v_source = 'form' OR v_source = 'meta' OR v_course_interest_val IS NOT NULL);
      v_payload_hash := md5(v_props::text);

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
            'Phone ' || v_phone || ' matches ' || cardinality(v_lead_matches)::text || ' leads in EDS HUB',
            'phone', v_props
          );
          v_conflict_count := v_conflict_count + 1;
          CONTINUE;
        END IF;
      END IF;

      IF v_matched_lead_id IS NOT NULL THEN
        -- RETURNING LEAD VIA HUBSPOT
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
               OR (lower(v_course_interest_val) = 'endodontic' AND lower(trim(elem)) LIKE '%endo%')
               OR (lower(v_course_interest_val) = 'endodontics' AND lower(trim(elem)) LIKE '%endo%')
               OR (lower(v_course_interest_val) LIKE '%endo%' AND (lower(trim(elem)) = 'endodontic' OR lower(trim(elem)) = 'endodontics'))
               OR (lower(v_course_interest_val) = 'periodontal' AND lower(trim(elem)) LIKE '%perio%')
               OR (lower(v_course_interest_val) = 'periodontal plastic' AND lower(trim(elem)) LIKE '%perio%')
               OR (lower(v_course_interest_val) LIKE '%perio%' AND (lower(trim(elem)) = 'periodontal' OR lower(trim(elem)) = 'periodontal plastic'))
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
          course_interest = v_merged_course_interest,
          course_interests = v_merged_course_interests,
          hubspot_contact_id = v_contact_id,
          last_inbound_activity_at = CASE WHEN v_is_form_submission THEN now() ELSE last_inbound_activity_at END,
          has_new_submission = CASE WHEN v_is_form_submission THEN true ELSE has_new_submission END,
          new_submission_at = CASE WHEN v_is_form_submission THEN now() ELSE new_submission_at END,
          updated_at = now()
        WHERE id = v_matched_lead_id;

        -- Upsert entity link
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
      ELSE
        -- CREATE NEW LEAD
        v_is_update := false;
        INSERT INTO public.leads (
          first_name, last_name, email, phone_raw, contact_preference,
          course_interest, course_interests,
          source, source_detail, pipeline_stage_id, hubspot_contact_id,
          last_inbound_activity_at, has_new_submission, new_submission_at,
          created_at, updated_at
        ) VALUES (
          v_first_name, v_last_name, v_email, v_phone, v_contact_pref,
          v_course_interest_val,
          CASE WHEN v_course_interest_val IS NOT NULL 
               THEN jsonb_build_array(v_course_interest_val) 
               ELSE '[]'::jsonb END,
          v_source, v_source_detail,
          (SELECT id FROM public.pipeline_stages WHERE is_default = true LIMIT 1),
          v_contact_id,
          CASE WHEN v_is_form_submission THEN now() ELSE now() END,
          false, NULL,
          now(), now()
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
          'Lead imported via HubSpot inbound sync (' || v_source_detail || ')', 
          jsonb_build_object('external_id', v_contact_id, 'source', v_source, 'source_detail', v_source_detail)
        );

        v_created_count := v_created_count + 1;
      END IF;

      -- Relational Course Linking
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
          COALESCE(v_props->>'form_name', v_course_interest_val, 'Formulário de Inscrição'),
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
          'hubspot_form_sub:' || v_contact_id || ':' || COALESCE(v_event_id, extract(epoch from now())::text)
        ) ON CONFLICT (idempotency_key) DO NOTHING;
      END IF;

    EXCEPTION WHEN OTHERS THEN
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
