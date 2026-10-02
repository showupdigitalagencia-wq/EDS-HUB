-- =============================================================================
-- Migration 00101: Website Course Info Intent Classification, Existing Lead Resurfacing & Pipeline Recency
-- =============================================================================
-- 1. Distinguishes Course Information Requests from True Enrollments
-- 2. Prevents `#course-info-form .contact-form` (/contact) from ever triggering
--    incomplete enrollment tasks ('Retomar inscrição') or push alerts
-- 3. Updates last_acquisition_at and resurfaces existing leads to the top of their
--    current pipeline stage on new inbound submissions while preserving created_at
-- 4. Merges multi-course interests into public.leads.course_interests
-- 5. Performs historical cleanup for incorrectly classified course info records
-- =============================================================================

-- 1. Guard capture_incomplete_enrollment_transaction against Contact & Course Info Forms
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
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_clean_email TEXT;
  v_clean_phone TEXT;
  v_resolved_course RECORD;
  v_resolved_course_id UUID;
  v_resolved_session_id UUID;
  v_clean_source_page TEXT;
  v_lead_by_email UUID;
  v_lead_by_phone UUID;
  v_target_lead_id UUID;
  v_capture_stage_id UUID;
  v_task_id UUID;
  v_attempt_id UUID;
  v_existing_incomplete RECORD;
  v_pending_task RECORD;
  v_session_title TEXT := '';
  v_slot INT;
  v_existing_interest RECORD;
BEGIN
  -- Strict Isolation: Course info and contact requests are NEVER enrollment attempts.
  -- Reject/ignore if source page or attempt originates from /contact or /request-course-information
  v_clean_source_page := NULLIF(trim(p_source_page), '');
  IF lower(COALESCE(v_clean_source_page, '')) LIKE '%/contact%'
     OR lower(COALESCE(v_clean_source_page, '')) LIKE '%request-course-information%'
     OR lower(COALESCE(v_clean_source_page, '')) LIKE '%course-info%' THEN
    RETURN jsonb_build_object(
      'success', true,
      'received', true,
      'status', 'ignored_not_enrollment_form',
      'message', 'Course information requests cannot be captured as incomplete enrollments'
    );
  END IF;

  -- 1. Idempotency Check
  SELECT id, status, lead_id INTO v_existing_incomplete
  FROM public.incomplete_enrollments
  WHERE idempotency_key = trim(p_idempotency_key)
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'duplicate', true,
      'status', v_existing_incomplete.status,
      'attempt_id', v_existing_incomplete.id,
      'lead_id', v_existing_incomplete.lead_id
    );
  END IF;

  -- 2. Contact Sanitization
  v_clean_email := lower(NULLIF(trim(p_email), ''));
  v_clean_phone := NULLIF(trim(p_phone), '');

  IF v_clean_phone IS NOT NULL THEN
    v_clean_phone := regexp_replace(v_clean_phone, '[^\d+]', '', 'g');
    IF v_clean_phone !~ '^\+' THEN
      IF length(v_clean_phone) = 10 THEN
        v_clean_phone := '+1' || v_clean_phone;
      ELSIF length(v_clean_phone) = 11 AND v_clean_phone ~ '^1' THEN
        v_clean_phone := '+' || v_clean_phone;
      ELSIF length(v_clean_phone) > 10 THEN
        v_clean_phone := '+' || v_clean_phone;
      END IF;
    END IF;
  END IF;

  IF v_clean_email IS NULL AND v_clean_phone IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'At least one contact identifier (email or phone) is required'
    );
  END IF;

  -- 3. Resolve Course
  v_resolved_course_id := p_course_id;

  IF v_resolved_course_id IS NULL AND p_course_code IS NOT NULL THEN
    SELECT id, name INTO v_resolved_course
    FROM public.courses
    WHERE code = trim(p_course_code)
    LIMIT 1;

    IF FOUND THEN
      v_resolved_course_id := v_resolved_course.id;
    END IF;
  ELSE
    SELECT id, name INTO v_resolved_course
    FROM public.courses
    WHERE id = v_resolved_course_id
    LIMIT 1;
  END IF;

  IF v_resolved_course_id IS NULL OR v_resolved_course.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Valid course_id or course_code is required'
    );
  END IF;

  -- 4. Resolve Course Session
  v_resolved_session_id := p_course_session_id;

  IF v_resolved_session_id IS NULL AND p_session_code IS NOT NULL THEN
    SELECT id, title INTO v_resolved_session_id, v_session_title
    FROM public.course_sessions
    WHERE session_code = trim(p_session_code)
      AND course_id = v_resolved_course_id
    LIMIT 1;
  ELSIF v_resolved_session_id IS NOT NULL THEN
    SELECT title INTO v_session_title
    FROM public.course_sessions
    WHERE id = v_resolved_session_id
    LIMIT 1;
  END IF;

  -- 5. Lead Matching
  v_lead_by_email := NULL;
  v_lead_by_phone := NULL;

  IF v_clean_email IS NOT NULL THEN
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

  IF v_clean_phone IS NOT NULL THEN
    SELECT id INTO v_lead_by_phone
    FROM public.leads
    WHERE phone_e164 = v_clean_phone
      AND deleted_at IS NULL
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

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
      'website', 'website_registration_form',
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
      'Lead criado via tentativa de matrícula no site.',
      jsonb_build_object('source', 'website', 'source_detail', 'website_registration_form')
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

  -- Lead Course Interest Handling
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

  -- Deduplicate / Create Follow-up Task for True Registration Attempts
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
      'task_id', v_task_id,
      'source_page', v_clean_source_page
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'received', true,
    'status', 'needs_followup',
    'attempt_id', v_attempt_id,
    'lead_id', v_target_lead_id,
    'task_id', v_task_id,
    'course_name', v_resolved_course.name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.capture_incomplete_enrollment_transaction(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_incomplete_enrollment_transaction(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

-- 2. Update process_form_submission_transaction to properly handle Course Info Intent,
--    update last_acquisition_at on re-entry, and preserve stage & original created_at.
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

  -- 3. Canonical Multi-Email Resolution
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

  v_lead_by_phone := NULL;
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

  v_pref := NULLIF(trim(lower(COALESCE(p_contact_preference, ''))), '');
  IF v_pref NOT IN ('email', 'sms', 'call', 'whatsapp') THEN
    v_pref := NULL;
  END IF;

  -- Form intent classification:
  -- website-contact with course specified is a COURSE_INFORMATION_REQUEST, NOT an enrollment attempt.
  IF p_form_slug = 'website-contact' THEN
    v_assigned_source := 'website';
    v_assigned_source_detail := 'contact_form';
    IF v_clean_course IS NOT NULL THEN
      v_intent := 'COURSE_INFORMATION_REQUEST';
      v_activity_summary := 'Solicitou informações sobre ' || v_clean_course;
    ELSE
      v_intent := 'GENERAL_CONTACT';
      v_activity_summary := 'Contato recebido via site';
    END IF;
  ELSIF p_form_slug = 'website-register' THEN
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
      v_form.default_pipeline_stage_id, now(), now(),
      false, NULL, now(), now()
    ) RETURNING id INTO v_target_lead_id;

    PERFORM public.sync_lead_emails(v_target_lead_id, v_email_resolution->'emails');

    INSERT INTO public.lead_stage_history (
      lead_id, from_stage_id, to_stage_id, change_reason
    ) VALUES (
      v_target_lead_id, NULL, v_form.default_pipeline_stage_id, 'initial_assignment'
    );

    INSERT INTO public.lead_activities (
      lead_id, activity_type, actor_type, summary, metadata
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
      )
    );
  ELSE
    -- REPEAT SUBMISSION: Update existing lead, resurface card to TOP of current stage via last_acquisition_at = now()!
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
      last_acquisition_at = now(),
      last_inbound_activity_at = now(),
      has_new_submission = true,
      new_submission_at = now(),
      updated_at = now()
    WHERE id = v_target_lead_id;

    PERFORM public.sync_lead_emails(v_target_lead_id, v_email_resolution->'emails');

    INSERT INTO public.lead_activities (
      lead_id, activity_type, actor_type, summary, metadata
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
      )
    );
  END IF;

  -- 6. Insert form_submissions record
  INSERT INTO public.form_submissions (
    form_id, form_version, form_name, source, lead_id, intake_event_id, submitted_data,
    email, email_confirmation, email_mismatch, phone_e164, contact_preference, course_interest,
    source_detail, processing_status, processing_error,
    idempotency_key, ip_address, user_agent, submitted_at, processed_at
  ) VALUES (
    v_form.id, v_form.current_version, v_form.name, v_assigned_source, v_target_lead_id, NULL, p_submitted_data,
    v_clean_email, v_clean_email_conf, v_email_mismatch, p_phone_e164, v_pref, v_clean_course,
    v_assigned_source_detail, 'processed', NULL,
    p_idempotency_key, p_ip_address, p_user_agent, now(), now()
  ) RETURNING id INTO v_submission_id;

  -- 7. Insert lead_intake_events record
  INSERT INTO public.lead_intake_events (
    source, external_event_id, external_lead_id, idempotency_key,
    raw_payload, normalized_payload, status, lead_id, attempt_count, received_at
  ) VALUES (
    v_assigned_source, p_idempotency_key, v_target_lead_id::text,
    'form:' || v_form.id::text || ':' || p_idempotency_key,
    p_submitted_data,
    jsonb_build_object(
      'form_slug', v_form.slug,
      'email', v_clean_email,
      'email_confirmation', v_clean_email_conf,
      'email_mismatch', v_email_mismatch,
      'resolved_emails', v_email_resolution->'emails',
      'phone', p_phone_e164,
      'first_name', v_first_name,
      'last_name', v_last_name,
      'contact_preference', v_pref,
      'course_interest', v_clean_course,
      'source', v_assigned_source,
      'source_detail', v_assigned_source_detail,
      'intent', v_intent
    ),
    'processed', v_target_lead_id, 1, now()
  ) RETURNING id INTO v_intake_event_id;

  UPDATE public.form_submissions
  SET intake_event_id = v_intake_event_id
  WHERE id = v_submission_id;

  RETURN jsonb_build_object(
    'success', true,
    'is_duplicate', false,
    'submission_id', v_submission_id,
    'lead_id', v_target_lead_id,
    'intake_event_id', v_intake_event_id,
    'processing_status', 'processed',
    'intent', v_intent,
    'success_message', v_form.success_message,
    'redirect_url', v_form.redirect_url
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_form_submission_transaction TO service_role;
REVOKE EXECUTE ON FUNCTION public.process_form_submission_transaction FROM anon, authenticated, public;

-- 3. Update process_hubspot_inbound_batch
--    Correctly classifies `#course-info-form .contact-form` as website / contact_form (COURSE_INFORMATION_REQUEST),
--    preserves canonical leads, updates last_acquisition_at on re-entry, merges course_interests,
--    preserves current pipeline stage, logs factual activity, and stores form_submissions.
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
  v_source_created_at TIMESTAMPTZ;
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
BEGIN
  -- Resolve default capture stage
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

      -- Factual Source Attribution & Intent Classification
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
      ELSIF v_first_conv LIKE '%register%' OR v_recent_conv LIKE '%register%' OR v_analytics_data_1 LIKE '%register%' THEN
        v_source := 'website';
        v_source_detail := 'website_registration_form';
        v_intent := 'COMPLETED_ENROLLMENT';
      ELSIF v_origem LIKE '%meta%' OR v_origem LIKE '%facebook%' OR v_origem LIKE '%instagram%' OR
            v_first_conv LIKE '%lead ad%' OR v_first_conv LIKE '%facebook%' OR v_recent_conv LIKE '%lead ad%' OR
            lower(COALESCE(v_props->>'hs_analytics_source', '')) = 'paid_social' THEN
        v_source := 'meta';
        v_source_detail := 'meta_lead_ad';
        v_intent := 'META_LEAD_AD';
      ELSIF v_origem LIKE '%site%' OR v_origem LIKE '%website%' OR
            lower(COALESCE(v_props->>'hs_analytics_source', '')) IN ('organic_search', 'direct_traffic', 'referrals') THEN
        v_source := 'website';
        v_source_detail := 'website';
        v_intent := 'WEBSITE_ORGANIC';
      ELSE
        v_source := 'hubspot';
        v_source_detail := COALESCE(v_props->>'hs_analytics_source', 'hubspot_sync');
        v_intent := 'HUBSPOT_SYNC';
      END IF;

      -- Check existing lead by hubspot_contact_id or link
      v_matched_lead_id := NULL;

      SELECT eds_entity_id INTO v_matched_lead_id
      FROM public.integration_entity_links
      WHERE integration = 'hubspot'
        AND external_entity_id = v_contact_id
        AND status = 'active'
      LIMIT 1;

      IF v_matched_lead_id IS NULL THEN
        SELECT id INTO v_matched_lead_id
        FROM public.leads
        WHERE hubspot_contact_id = v_contact_id
          AND deleted_at IS NULL
        LIMIT 1;
      END IF;

      IF v_matched_lead_id IS NULL AND v_email IS NOT NULL THEN
        SELECT id INTO v_matched_lead_id
        FROM public.leads
        WHERE lower(email) = v_email
          AND deleted_at IS NULL
        LIMIT 1;

        IF v_matched_lead_id IS NULL THEN
          SELECT lead_id INTO v_matched_lead_id
          FROM public.lead_emails
          WHERE normalized_email = v_email
          LIMIT 1;
        END IF;
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

      IF v_matched_lead_id IS NOT NULL THEN
        -- UPDATE EXISTING LEAD:
        -- Strictly preserve original created_at and pipeline stage.
        -- Update last_acquisition_at to resurface card to top of stage.
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
          last_acquisition_at = COALESCE(v_event_ts, now()),
          last_inbound_activity_at = now(),
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

        -- Record form_submissions entry for traceability
        IF v_first_conv != '' OR v_recent_conv != '' THEN
          INSERT INTO public.form_submissions (
            lead_id, form_name, source, source_detail, course_interest, submitted_at, submitted_data,
            email, email_confirmation, email_mismatch, phone_e164, contact_preference,
            processing_status, recovery_state, idempotency_key
          ) VALUES (
            v_matched_lead_id,
            COALESCE(NULLIF(trim(v_props->>'recent_conversion_event_name'), ''), NULLIF(trim(v_props->>'first_conversion_event_name'), ''), 'HubSpot Form Submission'),
            CASE WHEN v_source = 'website' THEN 'Site' ELSE initcap(v_source) END,
            v_source_detail,
            v_course_interest_val,
            COALESCE(v_event_ts, now()),
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

          -- Log Course Information Request Activity
          IF v_source_detail = 'contact_form' AND v_course_interest_val IS NOT NULL THEN
            INSERT INTO public.lead_activities (
              lead_id, activity_type, actor_type, summary, metadata
            ) VALUES (
              v_matched_lead_id, 'form_submitted', 'system',
              'Solicitou informações sobre ' || v_course_interest_val,
              jsonb_build_object(
                'hubspot_contact_id', v_contact_id,
                'source', v_source,
                'source_detail', v_source_detail,
                'course', v_course_interest_val,
                'intent', 'COURSE_INFORMATION_REQUEST',
                'form_name', COALESCE(v_props->>'recent_conversion_event_name', v_props->>'first_conversion_event_name')
              )
            );
          END IF;
        END IF;

        v_updated_count := v_updated_count + 1;
      ELSE
        -- CREATE NEW LEAD
        INSERT INTO public.leads (
          source, source_detail, first_name, last_name, email, email_confirmation, email_mismatch,
          phone_raw, contact_preference, course_interest, course_interests,
          pipeline_stage_id, hubspot_contact_id, source_created_at,
          last_acquisition_at, last_inbound_activity_at, created_at, updated_at
        ) VALUES (
          v_source, v_source_detail, v_first_name, v_last_name, v_email, v_email_confirmation, v_email_mismatch,
          v_phone, v_contact_pref, v_course_interest_val,
          CASE WHEN v_course_interest_val IS NOT NULL THEN jsonb_build_array(v_course_interest_val) ELSE '[]'::jsonb END,
          v_capture_stage_id, v_contact_id, v_source_created_at,
          COALESCE(v_source_created_at, v_event_ts, now()), now(), now(), now()
        ) RETURNING id INTO v_matched_lead_id;

        PERFORM public.sync_lead_emails(v_matched_lead_id, v_email_resolution->'emails');

        INSERT INTO public.integration_entity_links (
          integration, entity_type, external_entity_id, eds_entity_id, status, created_at, updated_at
        ) VALUES (
          'hubspot', 'lead', v_contact_id, v_matched_lead_id, 'active', now(), now()
        ) ON CONFLICT (integration, entity_type, external_entity_id) WHERE status = 'active'
        DO UPDATE SET
          eds_entity_id = EXCLUDED.eds_entity_id,
          updated_at = now();

        IF v_source_detail = 'contact_form' AND v_course_interest_val IS NOT NULL THEN
          INSERT INTO public.lead_activities (
            lead_id, activity_type, actor_type, summary, metadata
          ) VALUES (
            v_matched_lead_id, 'form_submitted', 'system',
            'Solicitou informações sobre ' || v_course_interest_val,
            jsonb_build_object(
              'hubspot_contact_id', v_contact_id,
              'source', v_source,
              'source_detail', v_source_detail,
              'course', v_course_interest_val,
              'intent', 'COURSE_INFORMATION_REQUEST',
              'form_name', COALESCE(v_props->>'first_conversion_event_name', v_props->>'recent_conversion_event_name')
            )
          );
        ELSE
          INSERT INTO public.lead_activities (
            lead_id, activity_type, actor_type, summary, metadata
          ) VALUES (
            v_matched_lead_id, 'lead_created', 'system',
            'Lead synchronized from HubSpot: ' || COALESCE(v_first_name || ' ' || v_last_name, v_email, 'Novo Lead'),
            jsonb_build_object(
              'hubspot_contact_id', v_contact_id,
              'source', v_source,
              'source_detail', v_source_detail,
              'course', v_course_interest_val
            )
          );
        END IF;

        IF v_first_conv != '' OR v_recent_conv != '' THEN
          INSERT INTO public.form_submissions (
            lead_id, form_name, source, source_detail, course_interest, submitted_at, submitted_data,
            email, email_confirmation, email_mismatch, phone_e164, contact_preference,
            processing_status, recovery_state, idempotency_key
          ) VALUES (
            v_matched_lead_id,
            COALESCE(NULLIF(trim(v_props->>'first_conversion_event_name'), ''), NULLIF(trim(v_props->>'recent_conversion_event_name'), ''), 'HubSpot Form Submission'),
            CASE WHEN v_source = 'website' THEN 'Site' ELSE initcap(v_source) END,
            v_source_detail,
            v_course_interest_val,
            COALESCE(v_source_created_at, v_event_ts, now()),
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
          'course_interest', v_course_interest_val,
          'contact_preference', v_contact_pref
        ));

        v_created_count := v_created_count + 1;
      END IF;

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
    'created_count', v_created_count,
    'updated_count', v_updated_count,
    'ignored_count', v_ignored_count,
    'conflict_count', v_conflict_count,
    'created_leads', v_created_leads
  );
END;
$$;

-- 4. Historical Data Repair & Cleanup for Mark Fung, Pedro Noe Hernandez, and Test Leads
-- Mark Fung (6b550c6e-3177-47a5-9572-d7c7bfdbc723):
UPDATE public.leads
SET
  source = 'website',
  source_detail = 'contact_form',
  course_interest = 'Intensive Dental Implant Training',
  course_interests = jsonb_build_array('Intensive Dental Implant Training'),
  last_acquisition_at = '2026-10-02 04:40:42.037572+00',
  updated_at = now()
WHERE id = '6b550c6e-3177-47a5-9572-d7c7bfdbc723';

DELETE FROM public.tasks
WHERE id = 'a39d8b76-3a53-4ab1-a1c2-a02ca73849d4';

DELETE FROM public.incomplete_enrollments
WHERE id = 'e49c1941-89a8-42fb-a5a3-7538ec151914';

DELETE FROM public.lead_activities
WHERE id IN ('82e61316-bd68-4dd1-87b1-b4911e6207dd', '21efcb79-e1c5-4f4d-82d8-8a80a7b883d0');

INSERT INTO public.lead_activities (
  lead_id, activity_type, actor_type, summary, metadata, created_at
) VALUES (
  '6b550c6e-3177-47a5-9572-d7c7bfdbc723',
  'form_submitted',
  'system',
  'Solicitou informações sobre Intensive Dental Implant Training',
  jsonb_build_object(
    'source', 'website',
    'source_detail', 'contact_form',
    'course', 'Intensive Dental Implant Training',
    'form_name', 'Request Course Information — Expert Dental Solutions: #course-info-form .contact-form',
    'intent', 'COURSE_INFORMATION_REQUEST'
  ),
  '2026-10-02 04:40:42.037572+00'
);

INSERT INTO public.form_submissions (
  lead_id, form_name, source, source_detail, course_interest, submitted_at, submitted_data,
  email, email_confirmation, email_mismatch, phone_e164, processing_status, recovery_state, idempotency_key
) VALUES (
  '6b550c6e-3177-47a5-9572-d7c7bfdbc723',
  'Request Course Information — Expert Dental Solutions: #course-info-form .contact-form',
  'Site',
  'contact_form',
  'Intensive Dental Implant Training',
  '2026-10-02 04:40:42.037572+00',
  jsonb_build_object(
    'first_name', 'MARK',
    'last_name', 'FUNG',
    'email', 'mark_wing_fung@hotmail.com',
    'phone', '(658) 909-7198',
    'course_interest', 'Intensive Dental Implant Training',
    'form_name', 'Request Course Information — Expert Dental Solutions: #course-info-form .contact-form'
  ),
  'mark_wing_fung@hotmail.com',
  'mark_wing_fung@hotmail.com',
  false,
  '(658) 909-7198',
  'processed',
  'complete',
  'historical_mark_fung_course_info_20261002'
) ON CONFLICT (idempotency_key) DO NOTHING;

-- Pedro Noe Hernandez (ee80445e-700c-4d24-a4d2-470df37d376e):
UPDATE public.leads
SET
  course_interest = COALESCE(course_interest, 'Zygomatic'),
  course_interests = jsonb_build_array('Zygomatic', 'Advanced Dental Implant Experience'),
  last_acquisition_at = '2026-10-02 09:33:10.785492+00',
  updated_at = now()
WHERE id = 'ee80445e-700c-4d24-a4d2-470df37d376e';

DELETE FROM public.tasks
WHERE id = '742fd280-fe04-404b-84ee-95d61087a35d';

DELETE FROM public.incomplete_enrollments
WHERE id = '30105716-5692-4355-bc6c-f872229e05b8';

DELETE FROM public.lead_activities
WHERE id = 'e81b6a9d-51cc-4dbf-b65b-a4636260f363';

INSERT INTO public.lead_activities (
  lead_id, activity_type, actor_type, summary, metadata, created_at
) VALUES (
  'ee80445e-700c-4d24-a4d2-470df37d376e',
  'form_submitted',
  'system',
  'Solicitou informações sobre Advanced Dental Implant Experience',
  jsonb_build_object(
    'source', 'website',
    'source_detail', 'contact_form',
    'course', 'Advanced Dental Implant Experience',
    'form_name', 'Request Course Information — Expert Dental Solutions: #course-info-form .contact-form',
    'intent', 'COURSE_INFORMATION_REQUEST'
  ),
  '2026-10-02 09:33:10.785492+00'
);

INSERT INTO public.form_submissions (
  lead_id, form_name, source, source_detail, course_interest, submitted_at, submitted_data,
  email, email_confirmation, email_mismatch, phone_e164, processing_status, recovery_state, idempotency_key
) VALUES (
  'ee80445e-700c-4d24-a4d2-470df37d376e',
  'Request Course Information — Expert Dental Solutions: #course-info-form .contact-form',
  'Site',
  'contact_form',
  'Advanced Dental Implant Experience',
  '2026-10-02 09:33:10.785492+00',
  jsonb_build_object(
    'first_name', 'Pedro',
    'last_name', 'Noe Hernandez',
    'email', 'pedronoh.dmd@gmail.com',
    'phone', '+17472269505',
    'course_interest', 'Advanced Dental Implant Experience',
    'form_name', 'Request Course Information — Expert Dental Solutions: #course-info-form .contact-form'
  ),
  'pedronoh.dmd@gmail.com',
  'pedronoh.dmd@gmail.com',
  false,
  '+17472269505',
  'processed',
  'complete',
  'historical_pedro_course_info_20261002'
) ON CONFLICT (idempotency_key) DO NOTHING;

-- Clean up test lead 1922f2c3-e7b9-4a48-85b5-60ed7cf5be9c
DELETE FROM public.tasks WHERE id = '85d3cecf-32b6-4192-9a98-92b43db2da00';
DELETE FROM public.incomplete_enrollments WHERE lead_id = '1922f2c3-e7b9-4a48-85b5-60ed7cf5be9c';
