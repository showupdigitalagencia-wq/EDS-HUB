-- =============================================================================
-- Migration 00124: Fix Production Form Intake and Duplicate Prevention
-- =============================================================================
-- Purpose:
-- 1. Sets column default for public.lead_course_interests.source to 'form'
--    to prevent NOT NULL constraint crashes when recording interests.
-- 2. Updates capture_incomplete_enrollment_transaction RPC:
--    - Fixes INSERT into public.lead_course_interests: provides source ('form'),
--      status ('active') and ON CONFLICT (lead_id, course_id) DO UPDATE.
--    - Drops legacy 16-parameter overload to ensure single canonical RPC.
-- 3. Updates process_form_submission_transaction RPC:
--    - Preserves 100% of canonical logic from Migration 00122 (Retorno badge,
--      returning lead stage preservation, multi-course accumulation,
--      enrollment creation only for website-register, and turma linking).
--    - Strengthens idempotency check (Step 2) to match on p_external_attempt_id across
--      browser ('sub_...') and server-side ('comp_...') dispatches.
--    - Guarantees exactly ONE form submission, ONE lead acquisition, and
--      ONE set of operational notifications per submission attempt.
--    - Drops legacy 12-parameter overload to ensure single canonical RPC.
-- =============================================================================

-- 1. Ensure source column has a safe default on lead_course_interests
ALTER TABLE public.lead_course_interests
  ALTER COLUMN source SET DEFAULT 'form';

-- 2. Drop legacy overloads
DROP FUNCTION IF EXISTS public.capture_incomplete_enrollment_transaction(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
);

DROP FUNCTION IF EXISTS public.process_form_submission_transaction(
  TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
);

-- 3. Update capture_incomplete_enrollment_transaction RPC (19 parameters)
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
  p_utm_content TEXT,
  p_status TEXT DEFAULT 'needs_followup',
  p_failure_category TEXT DEFAULT NULL,
  p_submit_attempt_count INT DEFAULT 1
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
  v_slot INT;
  v_existing_incomplete RECORD;
  v_pending_task RECORD;
  v_task_id UUID := NULL;
  v_attempt_id UUID;
  v_session_title TEXT := '';
  v_effective_status TEXT;
  v_is_failed_submit BOOLEAN;
  v_new_attempt_count INT;
BEGIN
  v_effective_status := COALESCE(NULLIF(trim(p_status), ''), 'needs_followup');
  v_is_failed_submit := (v_effective_status = 'submission_failed');

  -- 1. Authoritative Idempotency Check by idempotency_key
  SELECT id, lead_id, processing_status, status, task_id, submit_attempt_count
  INTO v_existing
  FROM public.incomplete_enrollments
  WHERE idempotency_key = trim(p_idempotency_key);

  IF FOUND THEN
    IF v_is_failed_submit THEN
      v_new_attempt_count := COALESCE(v_existing.submit_attempt_count, 0) + 1;
      UPDATE public.incomplete_enrollments
      SET
        submit_attempt_count = v_new_attempt_count,
        last_failed_submission_at = now(),
        failure_category = COALESCE(p_failure_category, failure_category),
        updated_at = now()
      WHERE id = v_existing.id;

      IF v_existing.lead_id IS NOT NULL THEN
        INSERT INTO public.lead_activities (
          lead_id, activity_type, actor_type, summary, metadata
        ) VALUES (
          v_existing.lead_id, 'incomplete_enrollment_captured', 'system',
          'Tentativa de matrícula #' || v_new_attempt_count || ' falhou no site' ||
          CASE WHEN p_failure_category IS NOT NULL THEN ' (' || p_failure_category || ')' ELSE '' END,
          jsonb_build_object(
            'external_attempt_id', p_external_attempt_id,
            'failure_category', p_failure_category,
            'attempt_count', v_new_attempt_count
          )
        );
      END IF;

      RETURN jsonb_build_object(
        'success', true,
        'duplicate', true,
        'attempt_id', v_existing.id,
        'lead_id', v_existing.lead_id,
        'processing_status', v_existing.processing_status,
        'status', v_existing.status,
        'submit_attempt_count', v_new_attempt_count
      );
    ELSE
      RETURN jsonb_build_object(
        'success', true,
        'duplicate', true,
        'attempt_id', v_existing.id,
        'lead_id', v_existing.lead_id,
        'processing_status', v_existing.processing_status,
        'status', v_existing.status,
        'submit_attempt_count', v_existing.submit_attempt_count
      );
    END IF;
  END IF;

  -- 1.1 Check by external_attempt_id (Session Link)
  IF p_external_attempt_id IS NOT NULL AND trim(p_external_attempt_id) != '' THEN
    SELECT id, lead_id, processing_status, status, task_id, submit_attempt_count
    INTO v_existing
    FROM public.incomplete_enrollments
    WHERE external_attempt_id = trim(p_external_attempt_id)
      AND status IN ('needs_followup', 'form_completed')
    ORDER BY created_at DESC
    LIMIT 1;

    IF FOUND AND v_is_failed_submit THEN
      v_new_attempt_count := COALESCE(v_existing.submit_attempt_count, 0) + 1;
      UPDATE public.incomplete_enrollments
      SET
        submit_attempt_count = v_new_attempt_count,
        last_failed_submission_at = now(),
        failure_category = COALESCE(p_failure_category, failure_category),
        updated_at = now()
      WHERE id = v_existing.id;

      IF v_existing.lead_id IS NOT NULL THEN
        INSERT INTO public.lead_activities (
          lead_id, activity_type, actor_type, summary, metadata
        ) VALUES (
          v_existing.lead_id, 'incomplete_enrollment_captured', 'system',
          'Tentativa de matrícula #' || v_new_attempt_count || ' falhou no site' ||
          CASE WHEN p_failure_category IS NOT NULL THEN ' (' || p_failure_category || ')' ELSE '' END,
          jsonb_build_object(
            'external_attempt_id', p_external_attempt_id,
            'failure_category', p_failure_category,
            'attempt_count', v_new_attempt_count
          )
        );
      END IF;

      RETURN jsonb_build_object(
        'success', true,
        'updated_session', true,
        'attempt_id', v_existing.id,
        'lead_id', v_existing.lead_id,
        'processing_status', v_existing.processing_status,
        'status', v_existing.status,
        'submit_attempt_count', v_new_attempt_count
      );
    END IF;
  END IF;

  -- 2. Course Validation & Resolution with Safe Fallback
  IF p_course_id IS NOT NULL THEN
    SELECT id, code, name, active INTO v_resolved_course
    FROM public.courses
    WHERE id = p_course_id;
  ELSIF p_course_code IS NOT NULL AND trim(p_course_code) != '' THEN
    SELECT id, code, name, active INTO v_resolved_course
    FROM public.courses
    WHERE code = trim(p_course_code);
  END IF;

  -- Safe fallback: If course was not selected by visitor, resolve default active course
  IF v_resolved_course.id IS NULL THEN
    SELECT id, code, name, active INTO v_resolved_course
    FROM public.courses
    WHERE active = true
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_resolved_course.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No active courses configured in CRM', 'error_code', 'NO_COURSES');
  END IF;

  v_resolved_course_id := v_resolved_course.id;

  -- 3. Session Validation & Resolution (Optional)
  IF p_course_session_id IS NOT NULL THEN
    SELECT id, code, title, course_id INTO v_resolved_session
    FROM public.course_sessions
    WHERE id = p_course_session_id;

    IF FOUND AND v_resolved_session.course_id = v_resolved_course_id THEN
      v_resolved_session_id := v_resolved_session.id;
      v_session_title := COALESCE(v_resolved_session.title, '');
    END IF;
  ELSIF p_session_code IS NOT NULL AND trim(p_session_code) != '' THEN
    SELECT id, code, title, course_id INTO v_resolved_session
    FROM public.course_sessions
    WHERE code = trim(p_session_code);

    IF FOUND AND v_resolved_session.course_id = v_resolved_course_id THEN
      v_resolved_session_id := v_resolved_session.id;
      v_session_title := COALESCE(v_resolved_session.title, '');
    END IF;
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

  -- Sanitize source_page: origin + path only
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
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_clean_phone IS NOT NULL THEN
    SELECT id INTO v_lead_by_phone
    FROM public.leads
    WHERE phone_e164 = v_clean_phone
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  -- 6. Ambiguous Conflict Detection
  IF v_lead_by_email IS NOT NULL AND v_lead_by_phone IS NOT NULL AND v_lead_by_email != v_lead_by_phone THEN
    INSERT INTO public.incomplete_enrollments (
      processing_status, status, lead_id, course_id, course_session_id,
      idempotency_key, external_attempt_id, source_page,
      utm_source, utm_medium, utm_campaign, utm_term, utm_content,
      task_id, submit_attempt_count, last_failed_submission_at, failure_category,
      created_at, updated_at
    ) VALUES (
      'conflict', NULL, NULL, v_resolved_course_id, v_resolved_session_id,
      trim(p_idempotency_key), NULLIF(trim(p_external_attempt_id), ''), v_clean_source_page,
      NULLIF(trim(p_utm_source), ''), NULLIF(trim(p_utm_medium), ''), NULLIF(trim(p_utm_campaign), ''),
      NULLIF(trim(p_utm_term), ''), NULLIF(trim(p_utm_content), ''),
      NULL, CASE WHEN v_is_failed_submit THEN GREATEST(1, p_submit_attempt_count) ELSE 0 END,
      CASE WHEN v_is_failed_submit THEN now() ELSE NULL END,
      p_failure_category, now(), now()
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

  -- 8. Lead Course Interest Handling (guaranteed source = 'form', status = 'active', and on conflict update)
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
      v_target_lead_id, v_resolved_course_id, v_resolved_session_id, COALESCE(v_slot, 1),
      'form', 'active', now(), now()
    )
    ON CONFLICT (lead_id, course_id) DO UPDATE
    SET course_session_id = COALESCE(lead_course_interests.course_session_id, EXCLUDED.course_session_id),
        updated_at = now();
  END IF;

  -- 9. Task Deduplication
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
      v_target_lead_id, 'follow_up', 'system',
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
  v_new_attempt_count := CASE WHEN v_is_failed_submit THEN GREATEST(1, p_submit_attempt_count) ELSE 0 END;

  INSERT INTO public.incomplete_enrollments (
    processing_status, status, lead_id, course_id, course_session_id,
    idempotency_key, external_attempt_id, source_page,
    utm_source, utm_medium, utm_campaign, utm_term, utm_content,
    task_id, submit_attempt_count, last_failed_submission_at, failure_category,
    created_at, updated_at
  ) VALUES (
    'processed', 'needs_followup', v_target_lead_id, v_resolved_course_id, v_resolved_session_id,
    trim(p_idempotency_key), NULLIF(trim(p_external_attempt_id), ''), v_clean_source_page,
    NULLIF(trim(p_utm_source), ''), NULLIF(trim(p_utm_medium), ''), NULLIF(trim(p_utm_campaign), ''),
    NULLIF(trim(p_utm_term), ''), NULLIF(trim(p_utm_content), ''),
    v_task_id, v_new_attempt_count,
    CASE WHEN v_is_failed_submit THEN now() ELSE NULL END,
    p_failure_category, now(), now()
  ) RETURNING id INTO v_attempt_id;

  -- 11. Lead Activity
  IF v_is_failed_submit THEN
    INSERT INTO public.lead_activities (
      lead_id, activity_type, actor_type, summary, metadata
    ) VALUES (
      v_target_lead_id, 'incomplete_enrollment_captured', 'system',
      'Tentativa de matrícula #' || v_new_attempt_count || ' falhou no site' ||
      CASE WHEN p_failure_category IS NOT NULL THEN ' (' || p_failure_category || ')' ELSE '' END,
      jsonb_build_object(
        'attempt_id', v_attempt_id,
        'course_id', v_resolved_course_id,
        'course_name', v_resolved_course.name,
        'external_attempt_id', p_external_attempt_id,
        'failure_category', p_failure_category,
        'attempt_count', v_new_attempt_count
      )
    );
  ELSE
    INSERT INTO public.lead_activities (
      lead_id, activity_type, actor_type, summary, metadata
    ) VALUES (
      v_target_lead_id, 'incomplete_enrollment_captured', 'system',
      'Tentativa de inscrição capturada para o curso ' || v_resolved_course.name ||
      CASE WHEN v_session_title != '' THEN ' (Turma: ' || v_session_title || ')' ELSE '' END,
      jsonb_build_object(
        'attempt_id', v_attempt_id,
        'course_id', v_resolved_course_id,
        'course_session_id', v_resolved_session_id
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'attempt_id', v_attempt_id,
    'lead_id', v_target_lead_id,
    'processing_status', 'processed',
    'status', 'needs_followup',
    'submit_attempt_count', v_new_attempt_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.capture_incomplete_enrollment_transaction(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT
) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.capture_incomplete_enrollment_transaction(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT
) FROM anon, public;

-- 4. Update process_form_submission_transaction RPC (10 parameters)
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
  v_resolved_course_id UUID;
  v_resolved_course RECORD;
  v_resolved_session_id UUID := NULL;
  v_enrollment_id UUID := NULL;
  v_target_stage_id UUID;
  v_matricula_stage_id UUID;
  v_slot INT;
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

  -- Resolve canonical Matrícula stage ID
  SELECT id INTO v_matricula_stage_id
  FROM public.pipeline_stages
  WHERE code = 'enrollment'
  LIMIT 1;

  -- 2. Enhanced Cross-Layer Idempotency Check
  -- Matches by exact idempotency_key OR by external_attempt_id across browser ('sub_...')
  -- and HostGator backend ('comp_...') dispatches.
  SELECT id, lead_id, intake_event_id, processing_status
  INTO v_existing_sub
  FROM public.form_submissions
  WHERE idempotency_key = p_idempotency_key
     OR (
       p_external_attempt_id IS NOT NULL 
       AND NULLIF(trim(p_external_attempt_id), '') IS NOT NULL
       AND (
         submitted_data->>'external_attempt_id' = p_external_attempt_id
         OR submitted_data->>'attempt_id' = p_external_attempt_id
         OR idempotency_key = 'sub_' || p_form_slug || '_' || p_external_attempt_id
         OR idempotency_key = 'comp_' || p_external_attempt_id
         OR idempotency_key LIKE '%_' || p_external_attempt_id
       )
     )
  ORDER BY submitted_at ASC
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

  -- 3. Resolve Authoritative Timestamp
  v_authoritative_ts := NULLIF(trim(p_submitted_data->>'submitted_at'), '')::timestamptz;
  IF v_authoritative_ts IS NULL THEN
    v_authoritative_ts := now();
  END IF;

  -- 4. Resolve Canonical Emails
  v_email_resolution := public.resolve_intake_emails(
    p_email,
    p_submitted_data->>'email_confirmation'
  );

  v_clean_email := v_email_resolution->>'primary_email';
  v_clean_email_conf := v_email_resolution->>'confirmation_email';
  v_email_mismatch := (v_email_resolution->>'is_mismatch')::boolean;

  -- 5. Extract Names, Phone & Course
  v_first_name := NULLIF(trim(COALESCE(
    p_submitted_data->>'first_name',
    p_submitted_data->>'firstname',
    p_submitted_data->>'name',
    ''
  )), '');

  v_last_name := NULLIF(trim(COALESCE(
    p_submitted_data->>'last_name',
    p_submitted_data->>'lastname',
    ''
  )), '');

  -- Split full name if last_name missing
  IF v_first_name IS NOT NULL AND v_last_name IS NULL AND position(' ' in v_first_name) > 0 THEN
    v_last_name := trim(substring(v_first_name from position(' ' in v_first_name) + 1));
    v_first_name := trim(substring(v_first_name from 1 for position(' ' in v_first_name) - 1));
  END IF;

  v_clean_phone_raw := NULLIF(trim(COALESCE(
    p_submitted_data->>'phone',
    p_submitted_data->>'phone_raw',
    p_phone_e164,
    ''
  )), '');

  v_pref := lower(trim(COALESCE(
    p_contact_preference,
    p_submitted_data->>'contact_preference',
    p_submitted_data->>'preferencia_de_contato',
    'email'
  )));
  IF v_pref NOT IN ('email', 'sms', 'call', 'whatsapp') THEN
    v_pref := 'email';
  END IF;

  v_clean_course := NULLIF(trim(COALESCE(
    p_course_interest,
    p_submitted_data->>'course',
    p_submitted_data->>'course_interest',
    p_submitted_data->>'course_code',
    ''
  )), '');

  -- 6. Canonical Classification & Routing
  v_assigned_source := 'website';

  IF v_form.slug = 'website-course-info' OR v_form.source_detail = 'course_information_request' THEN
    v_assigned_source_detail := 'course_information_request';
    v_intent := 'course_info';
    v_activity_summary := 'Solicitou informações do curso via site';
  ELSIF v_form.slug IN ('website-contact', 'contact', 'contact-form', 'fale-conosco') OR v_form.source_detail = 'contact_form' THEN
    v_assigned_source_detail := 'contact_form';
    v_intent := 'contact_request';
    v_activity_summary := 'Mensagem enviada via formulário Fale Conosco';
  ELSIF v_form.slug IN ('website-register', 'register') OR v_form.source_detail = 'website_registration_form' THEN
    v_assigned_source_detail := 'website_registration_form';
    v_intent := 'enrollment';
    v_activity_summary := 'Inscrição via site';
  ELSE
    v_assigned_source_detail := COALESCE(v_form.source_detail, 'website');
    v_intent := 'form_submission';
    v_activity_summary := 'Formulário do site preenchido: ' || v_form.name;
  END IF;

  -- 7. Deduplication & Canonical Lead Resolution
  IF v_clean_email IS NOT NULL THEN
    v_lead_by_email := public.find_canonical_lead_by_email(v_clean_email);
  END IF;

  IF p_phone_e164 IS NOT NULL AND trim(p_phone_e164) != '' THEN
    SELECT id INTO v_lead_by_phone
    FROM public.leads
    WHERE phone_e164 = p_phone_e164
      AND deleted_at IS NULL
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_lead_by_phone IS NULL THEN
      SELECT id INTO v_lead_by_phone
      FROM public.leads
      WHERE phone_e164 = p_phone_e164
        AND deleted_at IS NOT NULL
      ORDER BY created_at ASC
      LIMIT 1;
    END IF;
  END IF;

  -- Cross-match conflict protection
  IF v_lead_by_email IS NOT NULL AND v_lead_by_phone IS NOT NULL AND v_lead_by_email != v_lead_by_phone THEN
    INSERT INTO public.form_submissions (
      form_id, form_name, form_version, submitted_data, email, phone_e164, contact_preference,
      course_interest, source_detail, processing_status, processing_error,
      idempotency_key, ip_address, user_agent, submitted_at, processed_at
    ) VALUES (
      v_form.id, v_form.slug, v_form.current_version, p_submitted_data, v_clean_email, p_phone_e164, v_pref,
      v_clean_course, v_assigned_source_detail, 'conflict',
      format('Conflict: email matches lead %s but phone matches lead %s', v_lead_by_email, v_lead_by_phone),
      p_idempotency_key, p_ip_address, p_user_agent, v_authoritative_ts, now()
    ) RETURNING id INTO v_submission_id;

    RETURN jsonb_build_object(
      'success', true,
      'submission_id', v_submission_id,
      'processing_status', 'conflict',
      'success_message', v_form.success_message,
      'redirect_url', v_form.redirect_url
    );
  END IF;

  v_target_lead_id := COALESCE(v_lead_by_email, v_lead_by_phone);

  -- 8. Lead Processing (Update vs Create)
  IF v_target_lead_id IS NOT NULL THEN
    -- RETURNING LEAD: Strictly preserve stage! Accumulate courses!
    -- Factually marks is_returning_submission = true!
    SELECT course_interest, course_interests
    INTO v_existing_course_interest, v_existing_course_interests
    FROM public.leads
    WHERE id = v_target_lead_id;

    v_merged_course_interests := COALESCE(v_existing_course_interests, '[]'::jsonb);
    IF v_clean_course IS NOT NULL AND trim(v_clean_course) != '' THEN
      IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(v_merged_course_interests) elem
        WHERE lower(trim(elem)) = lower(trim(v_clean_course))
           OR (lower(trim(v_clean_course)) LIKE '%zygo%' AND lower(trim(elem)) LIKE '%zygo%')
           OR (lower(trim(v_clean_course)) LIKE '%wisdom%' AND lower(trim(elem)) LIKE '%wisdom%')
           OR (lower(trim(v_clean_course)) LIKE '%intensiv%' AND lower(trim(elem)) LIKE '%intensiv%')
           OR (lower(trim(v_clean_course)) LIKE '%advanced%' AND lower(trim(elem)) LIKE '%advanced%')
      ) THEN
        v_merged_course_interests := v_merged_course_interests || jsonb_build_array(v_clean_course);
      END IF;
    END IF;

    IF v_existing_course_interest IS NULL OR trim(v_existing_course_interest) = '' THEN
      v_merged_course_interest := v_clean_course;
    ELSIF v_clean_course IS NOT NULL AND trim(v_clean_course) != '' THEN
      IF NOT (
        lower(v_existing_course_interest) LIKE '%' || lower(trim(v_clean_course)) || '%'
        OR (lower(trim(v_clean_course)) LIKE '%zygo%' AND lower(v_existing_course_interest) LIKE '%zygo%')
        OR (lower(trim(v_clean_course)) LIKE '%wisdom%' AND lower(v_existing_course_interest) LIKE '%wisdom%')
        OR (lower(trim(v_clean_course)) LIKE '%intensiv%' AND lower(v_existing_course_interest) LIKE '%intensiv%')
        OR (lower(trim(v_clean_course)) LIKE '%advanced%' AND lower(v_existing_course_interest) LIKE '%advanced%')
      ) THEN
        v_merged_course_interest := v_existing_course_interest || ', ' || v_clean_course;
      ELSE
        v_merged_course_interest := v_existing_course_interest;
      END IF;
    ELSE
      v_merged_course_interest := v_existing_course_interest;
    END IF;

    UPDATE public.leads
    SET
      first_name = COALESCE(v_first_name, first_name),
      last_name = COALESCE(v_last_name, last_name),
      email_confirmation = COALESCE(v_clean_email_conf, email_confirmation),
      email_mismatch = (v_email_mismatch OR COALESCE(email_mismatch, false)),
      phone_raw = COALESCE(v_clean_phone_raw, phone_raw),
      phone_e164 = COALESCE(p_phone_e164, phone_e164),
      contact_preference = COALESCE(v_pref, contact_preference),
      course_interest = v_merged_course_interest,
      course_interests = v_merged_course_interests,
      last_acquisition_at = GREATEST(COALESCE(last_acquisition_at, '-infinity'::timestamptz), v_authoritative_ts),
      last_inbound_activity_at = GREATEST(COALESCE(last_inbound_activity_at, '-infinity'::timestamptz), v_authoritative_ts),
      has_new_submission = true,
      new_submission_at = GREATEST(COALESCE(new_submission_at, '-infinity'::timestamptz), v_authoritative_ts),
      new_inbound_count = COALESCE(new_inbound_count, 0) + 1,
      is_returning_submission = true,
      deleted_at = NULL,
      updated_at = now()
    WHERE id = v_target_lead_id;

  ELSE
    -- NEW LEAD:
    -- Canonical Rule B1: Brand-new completed registration moves directly to Matrícula!
    -- Other forms (Contact, Course Info) use their default starting stage (capture / Novo Lead).
    IF v_form.slug IN ('website-register', 'register') OR v_assigned_source_detail = 'website_registration_form' THEN
      v_target_stage_id := COALESCE(v_matricula_stage_id, v_form.default_pipeline_stage_id);
    ELSE
      v_target_stage_id := v_form.default_pipeline_stage_id;
    END IF;

    INSERT INTO public.leads (
      source, source_detail,
      first_name, last_name, email, email_confirmation, email_mismatch,
      phone_raw, phone_e164, contact_preference,
      course_interest, course_interests,
      pipeline_stage_id,
      last_acquisition_at, last_inbound_activity_at,
      has_new_submission, new_submission_at, new_inbound_count,
      is_returning_submission,
      created_at, updated_at
    ) VALUES (
      v_assigned_source, v_assigned_source_detail,
      COALESCE(v_first_name, 'Lead'), v_last_name, v_clean_email, v_clean_email_conf, v_email_mismatch,
      v_clean_phone_raw, p_phone_e164, v_pref,
      v_clean_course,
      CASE WHEN v_clean_course IS NOT NULL THEN jsonb_build_array(v_clean_course) ELSE '[]'::jsonb END,
      v_target_stage_id,
      v_authoritative_ts, v_authoritative_ts,
      true, v_authoritative_ts, 1,
      false,
      v_authoritative_ts, now()
    ) RETURNING id INTO v_target_lead_id;

    INSERT INTO public.lead_stage_history (
      lead_id, from_stage_id, to_stage_id, change_reason
    ) VALUES (
      v_target_lead_id, NULL, v_target_stage_id,
      CASE
        WHEN v_target_stage_id = v_matricula_stage_id THEN 'completed_website_registration'
        ELSE 'initial_form_submission'
      END
    );
  END IF;

  -- 9. Relational course resolution & course_sessions / enrollments
  IF v_clean_course IS NOT NULL AND trim(v_clean_course) != '' THEN
    SELECT id, code, name, default_price, currency INTO v_resolved_course
    FROM public.courses
    WHERE active = true
      AND (
        lower(name) = lower(v_clean_course)
        OR lower(code) = lower(v_clean_course)
        OR lower(name) LIKE '%' || lower(v_clean_course) || '%'
        OR (lower(v_clean_course) LIKE '%zygo%' AND lower(name) LIKE '%zygo%')
        OR (lower(v_clean_course) LIKE '%wisdom%' AND lower(name) LIKE '%wisdom%')
        OR (lower(v_clean_course) LIKE '%intensiv%' AND lower(name) LIKE '%intensiv%')
        OR (lower(v_clean_course) LIKE '%advanced%' AND lower(name) LIKE '%advanced%')
        OR (lower(v_clean_course) LIKE '%endo%' AND lower(name) LIKE '%endo%')
        OR (lower(v_clean_course) LIKE '%perio%' AND lower(name) LIKE '%perio%')
        OR (lower(v_clean_course) LIKE '%rehab%' AND lower(name) LIKE '%rehab%')
      )
    ORDER BY
      CASE
        WHEN lower(name) = lower(v_clean_course) THEN 1
        WHEN lower(code) = lower(v_clean_course) THEN 2
        ELSE 3
      END ASC
    LIMIT 1;

    IF v_resolved_course.id IS NOT NULL THEN
      v_resolved_course_id := v_resolved_course.id;

      -- Check if course session / turma is referenced
      IF p_submitted_data->>'session_code' IS NOT NULL THEN
        SELECT id INTO v_resolved_session_id
        FROM public.course_sessions
        WHERE course_id = v_resolved_course_id
          AND session_code = trim(p_submitted_data->>'session_code')
        LIMIT 1;
      ELSIF p_submitted_data->>'turma' IS NOT NULL AND trim(p_submitted_data->>'turma') != '' THEN
        SELECT id INTO v_resolved_session_id
        FROM public.course_sessions
        WHERE course_id = v_resolved_course_id
          AND lower(trim(title)) = lower(trim(p_submitted_data->>'turma'))
        LIMIT 1;
      END IF;

      -- 9a. Upsert lead_course_interests
      IF NOT EXISTS (
        SELECT 1 FROM public.lead_course_interests
        WHERE lead_id = v_target_lead_id AND course_id = v_resolved_course_id
      ) THEN
        SELECT slot INTO v_slot
        FROM unnest(ARRAY[1, 2, 3]) AS slot
        WHERE slot NOT IN (
          SELECT priority FROM public.lead_course_interests WHERE lead_id = v_target_lead_id
        )
        ORDER BY slot ASC
        LIMIT 1;

        IF v_slot IS NOT NULL THEN
          INSERT INTO public.lead_course_interests (
            lead_id, course_id, course_session_id, priority, notes, source, status, created_at, updated_at
          ) VALUES (
            v_target_lead_id, v_resolved_course_id, v_resolved_session_id, v_slot,
            'Adicionado via formulário: ' || v_form.name,
            'website', 'active',
            v_authoritative_ts, now()
          );
        END IF;
      ELSIF v_resolved_session_id IS NOT NULL THEN
        UPDATE public.lead_course_interests
        SET course_session_id = v_resolved_session_id,
            updated_at = now()
        WHERE lead_id = v_target_lead_id
          AND course_id = v_resolved_course_id
          AND course_session_id IS NULL;
      END IF;

      -- 9b. Canonical Completed Registration Rule: Create/link completed enrollment!
      -- Strictly for COMPLETED registrations (website-register), NEVER for course-info or contact-us!
      IF v_intent = 'enrollment' OR v_assigned_source_detail = 'website_registration_form' THEN
        SELECT id INTO v_enrollment_id
        FROM public.enrollments
        WHERE lead_id = v_target_lead_id
          AND course_id = v_resolved_course_id
        LIMIT 1;

        IF v_enrollment_id IS NOT NULL THEN
          UPDATE public.enrollments
          SET course_session_id = COALESCE(v_resolved_session_id, course_session_id),
              course_name_snapshot = v_resolved_course.name,
              enrollment_status = 'confirmed',
              updated_at = now()
          WHERE id = v_enrollment_id;
        ELSE
          INSERT INTO public.enrollments (
            lead_id, course_id, course_session_id, course_name_snapshot,
            enrollment_status, agreed_amount, currency, enrollment_date,
            source, idempotency_key
          ) VALUES (
            v_target_lead_id, v_resolved_course_id, v_resolved_session_id, v_resolved_course.name,
            'confirmed', COALESCE(v_resolved_course.default_price, 0.00),
            COALESCE(v_resolved_course.currency, 'USD'),
            CURRENT_DATE,
            'website',
            'enrollment_' || v_target_lead_id || '_' || v_resolved_course_id
          ) RETURNING id INTO v_enrollment_id;
        END IF;
      END IF;
    END IF;
  END IF;

  -- 10. Sync Lead Emails
  PERFORM public.sync_lead_emails(v_target_lead_id, v_email_resolution->'emails');

  -- 11. Create Intake Event
  INSERT INTO public.lead_intake_events (
    source, source_detail, external_event_id, external_lead_id, idempotency_key,
    raw_payload, normalized_payload, status, lead_id, received_at, processed_at
  ) VALUES (
    v_assigned_source,
    v_assigned_source_detail,
    v_form.slug || ':' || p_idempotency_key,
    p_external_attempt_id,
    p_idempotency_key,
    p_submitted_data,
    jsonb_build_object(
      'form_slug', v_form.slug,
      'form_name', v_form.name,
      'submitted_data', p_submitted_data,
      'external_attempt_id', p_external_attempt_id,
      'intent', v_intent,
      'source_detail', v_assigned_source_detail,
      'enrollment_id', v_enrollment_id
    ),
    'processed',
    v_target_lead_id,
    v_authoritative_ts,
    now()
  ) RETURNING id INTO v_intake_event_id;

  -- 12. Create Form Submission
  INSERT INTO public.form_submissions (
    form_id, form_name, form_version, lead_id, intake_event_id,
    submitted_data, email, email_confirmation, email_mismatch,
    phone_e164, contact_preference, course_interest, source_detail,
    processing_status, idempotency_key, ip_address, user_agent,
    submitted_at, processed_at
  ) VALUES (
    v_form.id, v_form.slug, v_form.current_version, v_target_lead_id, v_intake_event_id,
    p_submitted_data, v_clean_email, v_clean_email_conf, v_email_mismatch,
    p_phone_e164, v_pref, v_clean_course, v_assigned_source_detail,
    'processed', p_idempotency_key, p_ip_address, p_user_agent,
    v_authoritative_ts, now()
  ) RETURNING id INTO v_submission_id;

  -- 13. Audit Activity
  INSERT INTO public.lead_activities (
    lead_id, intake_event_id, activity_type, actor_type, summary, metadata, created_at
  ) VALUES (
    v_target_lead_id, v_intake_event_id, 'form_submitted', 'system',
    v_activity_summary,
    jsonb_build_object(
      'form_slug', v_form.slug,
      'form_name', v_form.name,
      'source', v_assigned_source,
      'source_detail', v_assigned_source_detail,
      'submission_id', v_submission_id,
      'external_attempt_id', p_external_attempt_id,
      'intent', v_intent,
      'enrollment_id', v_enrollment_id
    ),
    v_authoritative_ts
  );

  RETURN jsonb_build_object(
    'success', true,
    'is_duplicate', false,
    'submission_id', v_submission_id,
    'lead_id', v_target_lead_id,
    'intake_event_id', v_intake_event_id,
    'enrollment_id', v_enrollment_id,
    'processing_status', 'processed',
    'success_message', v_form.success_message,
    'redirect_url', v_form.redirect_url,
    'authoritative_timestamp', v_authoritative_ts
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_form_submission_transaction(
  TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.process_form_submission_transaction(
  TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM anon, public;
