-- Migration 00086: Resolve Incomplete Enrollments on Form Completion & Safe Incomplete Capture
-- =============================================================================

-- 1. Relax/extend incomplete_enrollments check constraints
ALTER TABLE public.incomplete_enrollments 
  DROP CONSTRAINT IF EXISTS incomplete_enrollments_status_check;

ALTER TABLE public.incomplete_enrollments 
  ADD CONSTRAINT incomplete_enrollments_status_check 
  CHECK (status IS NULL OR status IN ('needs_followup', 'recovered', 'dismissed', 'completed', 'submission_failed'));

ALTER TABLE public.incomplete_enrollments 
  DROP CONSTRAINT IF EXISTS incomplete_enrollments_processing_status_check;

ALTER TABLE public.incomplete_enrollments 
  ADD CONSTRAINT incomplete_enrollments_processing_status_check 
  CHECK (processing_status IN ('processed', 'conflict', 'failed'));

-- 2. Update process_form_submission_transaction to resolve incomplete enrollments & tasks
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

-- 3. Update capture_incomplete_enrollment_transaction to support safe priority slot and conflict avoidance
CREATE OR REPLACE FUNCTION public.capture_incomplete_enrollment_transaction(
  p_idempotency_key TEXT,
  p_external_attempt_id TEXT,
  p_first_name TEXT,
  p_last_name TEXT,
  p_email TEXT,
  p_phone TEXT,
  p_course_id UUID,
  p_course_code TEXT,
  p_course_session_id UUID,
  p_session_code TEXT,
  p_source_page TEXT,
  p_utm_source TEXT,
  p_utm_medium TEXT,
  p_utm_campaign TEXT,
  p_utm_term TEXT,
  p_utm_content TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing RECORD;
  v_resolved_course RECORD;
  v_resolved_session RECORD;
  v_resolved_course_id UUID;
  v_resolved_session_id UUID;
  v_clean_email TEXT;
  v_clean_phone TEXT;
  v_clean_source_page TEXT;
  v_lead_by_email UUID := NULL;
  v_lead_by_phone UUID := NULL;
  v_target_lead_id UUID := NULL;
  v_capture_stage_id UUID;
  v_existing_interest RECORD;
  v_slot INT := NULL;
  v_existing_incomplete RECORD;
  v_pending_task RECORD;
  v_task_id UUID := NULL;
  v_attempt_id UUID;
  v_session_title TEXT := '';
BEGIN
  -- 1. Authoritative Idempotency Check
  SELECT id, lead_id, processing_status, status, task_id
  INTO v_existing
  FROM public.incomplete_enrollments
  WHERE idempotency_key = trim(p_idempotency_key);

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'duplicate', true,
      'attempt_id', v_existing.id,
      'lead_id', v_existing.lead_id,
      'processing_status', v_existing.processing_status,
      'status', v_existing.status
    );
  END IF;

  -- 2. Course Validation & Resolution
  IF p_course_id IS NOT NULL THEN
    SELECT id, code, name, active INTO v_resolved_course
    FROM public.courses
    WHERE id = p_course_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Course not found by ID', 'error_code', 'COURSE_NOT_FOUND');
    END IF;

    IF p_course_code IS NOT NULL AND trim(p_course_code) != '' AND v_resolved_course.code != trim(p_course_code) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Course ID and code disagree', 'error_code', 'COURSE_MISMATCH');
    END IF;
  ELSIF p_course_code IS NOT NULL AND trim(p_course_code) != '' THEN
    SELECT id, code, name, active INTO v_resolved_course
    FROM public.courses
    WHERE code = trim(p_course_code);

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Course not found by code', 'error_code', 'COURSE_NOT_FOUND');
    END IF;
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'Course identifier is required', 'error_code', 'MISSING_COURSE');
  END IF;

  IF NOT v_resolved_course.active THEN
    RETURN jsonb_build_object('success', false, 'error', 'Course is inactive', 'error_code', 'COURSE_INACTIVE');
  END IF;

  v_resolved_course_id := v_resolved_course.id;

  -- 3. Session Validation & Resolution (Optional)
  IF p_course_session_id IS NOT NULL THEN
    SELECT id, code, title, course_id INTO v_resolved_session
    FROM public.course_sessions
    WHERE id = p_course_session_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Course session not found by ID', 'error_code', 'SESSION_NOT_FOUND');
    END IF;

    IF p_session_code IS NOT NULL AND trim(p_session_code) != '' AND v_resolved_session.code != trim(p_session_code) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Session ID and code disagree', 'error_code', 'SESSION_MISMATCH');
    END IF;

    IF v_resolved_session.course_id != v_resolved_course_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'Session does not belong to course', 'error_code', 'SESSION_COURSE_MISMATCH');
    END IF;

    v_resolved_session_id := v_resolved_session.id;
    v_session_title := COALESCE(v_resolved_session.title, '');
  ELSIF p_session_code IS NOT NULL AND trim(p_session_code) != '' THEN
    SELECT id, code, title, course_id INTO v_resolved_session
    FROM public.course_sessions
    WHERE code = trim(p_session_code);

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Course session not found by code', 'error_code', 'SESSION_NOT_FOUND');
    END IF;

    IF v_resolved_session.course_id != v_resolved_course_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'Session does not belong to course', 'error_code', 'SESSION_COURSE_MISMATCH');
    END IF;

    v_resolved_session_id := v_resolved_session.id;
    v_session_title := COALESCE(v_resolved_session.title, '');
  END IF;

  -- 4. Clean Inputs
  v_clean_email := NULLIF(lower(trim(COALESCE(p_email, ''))), '');
  IF p_phone IS NOT NULL AND trim(p_phone) != '' THEN
    v_clean_phone := regexp_replace(p_phone, '[^\d+]', '', 'g');
    IF NOT v_clean_phone LIKE '+%' AND length(v_clean_phone) >= 10 THEN
      v_clean_phone := '+' || v_clean_phone;
    END IF;
  ELSE
    v_clean_phone := NULL;
  END IF;

  -- Sanitize source_page: origin + path only (strip ? and #)
  IF p_source_page IS NOT NULL AND trim(p_source_page) != '' THEN
    v_clean_source_page := split_part(split_part(trim(p_source_page), '?', 1), '#', 1);
  ELSE
    v_clean_source_page := NULL;
  END IF;

  -- 5. Lead Matching
  IF v_clean_email IS NOT NULL THEN
    SELECT id INTO v_lead_by_email
    FROM public.leads
    WHERE email = v_clean_email
      AND deleted_at IS NULL
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_clean_phone IS NOT NULL THEN
    SELECT id INTO v_lead_by_phone
    FROM public.leads
    WHERE phone_e164 = v_clean_phone
      AND deleted_at IS NULL
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  -- 6. Ambiguous Conflict Detection (Email matches Lead A, Phone matches Lead B)
  IF v_lead_by_email IS NOT NULL AND v_lead_by_phone IS NOT NULL AND v_lead_by_email != v_lead_by_phone THEN
    INSERT INTO public.incomplete_enrollments (
      processing_status, status, lead_id, course_id, course_session_id,
      idempotency_key, external_attempt_id, source_page,
      utm_source, utm_medium, utm_campaign, utm_term, utm_content,
      task_id, created_at, updated_at
    ) VALUES (
      'conflict', NULL, NULL, v_resolved_course_id, v_resolved_session_id,
      trim(p_idempotency_key), NULLIF(trim(p_external_attempt_id), ''), v_clean_source_page,
      NULLIF(trim(p_utm_source), ''), NULLIF(trim(p_utm_medium), ''), NULLIF(trim(p_utm_campaign), ''),
      NULLIF(trim(p_utm_term), ''), NULLIF(trim(p_utm_content), ''),
      NULL, now(), now()
    ) RETURNING id INTO v_attempt_id;

    RETURN jsonb_build_object(
      'success', true,
      'received', true,
      'processing_status', 'conflict',
      'attempt_id', v_attempt_id
    );
  END IF;

  -- 7. Resolve or Create Lead
  v_target_lead_id := COALESCE(v_lead_by_email, v_lead_by_phone);

  IF v_target_lead_id IS NULL THEN
    SELECT id INTO v_capture_stage_id
    FROM public.pipeline_stages
    WHERE code = 'capture';

    INSERT INTO public.leads (
      source, source_detail, first_name, last_name,
      email, email_confirmation, phone_raw, phone_e164,
      contact_preference, pipeline_stage_id, created_at, updated_at
    ) VALUES (
      'form', 'website_incomplete_enrollment',
      COALESCE(NULLIF(trim(p_first_name), ''), 'Lead'),
      NULLIF(trim(p_last_name), ''),
      v_clean_email, v_clean_email,
      p_phone, v_clean_phone,
      'email', v_capture_stage_id, now(), now()
    ) RETURNING id INTO v_target_lead_id;

    INSERT INTO public.lead_activities (
      lead_id, activity_type, actor_type, summary, metadata
    ) VALUES (
      v_target_lead_id, 'lead_created', 'system',
      'Lead criado via tentativa de inscrição no site.',
      jsonb_build_object('source', 'form', 'source_detail', 'website_incomplete_enrollment')
    );
  ELSE
    UPDATE public.leads
    SET
      last_name = CASE WHEN last_name IS NULL THEN NULLIF(trim(p_last_name), '') ELSE last_name END,
      phone_raw = CASE WHEN phone_raw IS NULL THEN p_phone ELSE phone_raw END,
      phone_e164 = CASE WHEN phone_e164 IS NULL THEN v_clean_phone ELSE phone_e164 END,
      updated_at = now()
    WHERE id = v_target_lead_id;
  END IF;

  -- 8. Lead Course Interest Handling (Preserve Existing Sessions & Safe Priority Slot)
  SELECT id, course_session_id INTO v_existing_interest
  FROM public.lead_course_interests
  WHERE lead_id = v_target_lead_id AND course_id = v_resolved_course_id
  LIMIT 1;

  IF FOUND THEN
    IF v_existing_interest.course_session_id IS NULL AND v_resolved_session_id IS NOT NULL THEN
      UPDATE public.lead_course_interests
      SET course_session_id = v_resolved_session_id, updated_at = now()
      WHERE id = v_existing_interest.id;
    END IF;
  ELSE
    SELECT slot INTO v_slot
    FROM unnest(ARRAY[1, 2, 3]) AS slot
    WHERE slot NOT IN (
      SELECT priority FROM public.lead_course_interests
      WHERE lead_id = v_target_lead_id AND priority IS NOT NULL
    )
    ORDER BY slot ASC
    LIMIT 1;

    INSERT INTO public.lead_course_interests (
      lead_id, course_id, course_session_id, priority, source, status, created_at, updated_at
    ) VALUES (
      v_target_lead_id, v_resolved_course_id, v_resolved_session_id, v_slot, 'form', 'active', now(), now()
    ) ON CONFLICT (lead_id, course_id) DO NOTHING;
  END IF;

  -- 9. Session-Aware Task Deduplication
  SELECT id, task_id INTO v_existing_incomplete
  FROM public.incomplete_enrollments
  WHERE lead_id = v_target_lead_id
    AND course_id = v_resolved_course_id
    AND course_session_id IS NOT DISTINCT FROM v_resolved_session_id
    AND status = 'needs_followup'
    AND task_id IS NOT NULL
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing_incomplete.task_id IS NOT NULL THEN
    SELECT id INTO v_pending_task
    FROM public.tasks
    WHERE id = v_existing_incomplete.task_id AND status = 'pending';

    IF FOUND THEN
      v_task_id := v_pending_task.id;
    END IF;
  END IF;

  IF v_task_id IS NULL THEN
    INSERT INTO public.tasks (
      lead_id, task_type, task_source, title, description,
      status, due_at, course_session_id, created_by, created_at, updated_at
    ) VALUES (
      v_target_lead_id, 'follow_up', 'incomplete_enrollment',
      'Retomar inscrição: ' || v_resolved_course.name,
      'Inscrição iniciada no site e não concluída para o curso ' || v_resolved_course.name ||
      CASE WHEN v_session_title != '' THEN ' (Turma: ' || v_session_title || ')' ELSE '' END ||
      '. Entrar em contato para tirar dúvidas e auxiliar na matrícula.',
      'pending', now() + interval '2 hours', v_resolved_session_id,
      'system', now(), now()
    ) RETURNING id INTO v_task_id;

    INSERT INTO public.lead_activities (
      lead_id, activity_type, actor_type, summary, metadata
    ) VALUES (
      v_target_lead_id, 'task_created', 'system',
      'Tarefa criada: Retomar inscrição: ' || v_resolved_course.name,
      jsonb_build_object('task_id', v_task_id, 'task_type', 'follow_up')
    );
  END IF;

  -- 10. Insert Incomplete Enrollment Attempt Row
  INSERT INTO public.incomplete_enrollments (
    processing_status, status, lead_id, course_id, course_session_id,
    idempotency_key, external_attempt_id, source_page,
    utm_source, utm_medium, utm_campaign, utm_term, utm_content,
    task_id, created_at, updated_at
  ) VALUES (
    'processed', 'needs_followup', v_target_lead_id, v_resolved_course_id, v_resolved_session_id,
    trim(p_idempotency_key), NULLIF(trim(p_external_attempt_id), ''), v_clean_source_page,
    NULLIF(trim(p_utm_source), ''), NULLIF(trim(p_utm_medium), ''), NULLIF(trim(p_utm_campaign), ''),
    NULLIF(trim(p_utm_term), ''), NULLIF(trim(p_utm_content), ''),
    v_task_id, now(), now()
  ) RETURNING id INTO v_attempt_id;

  -- 11. Lead Activity
  INSERT INTO public.lead_activities (
    lead_id, activity_type, actor_type, summary, metadata
  ) VALUES (
    v_target_lead_id, 'incomplete_enrollment_captured', 'system',
    'Inscrição iniciada no site e não concluída: ' || v_resolved_course.name,
    jsonb_build_object(
      'attempt_id', v_attempt_id,
      'course_id', v_resolved_course_id,
      'course_name', v_resolved_course.name,
      'course_session_id', v_resolved_session_id,
      'session_title', v_session_title,
      'source_page', v_clean_source_page,
      'task_id', v_task_id
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'received', true,
    'processing_status', 'processed',
    'status', 'needs_followup',
    'attempt_id', v_attempt_id,
    'lead_id', v_target_lead_id,
    'task_id', v_task_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.capture_incomplete_enrollment_transaction(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_incomplete_enrollment_transaction(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
