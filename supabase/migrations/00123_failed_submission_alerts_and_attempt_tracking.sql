-- =============================================================================
-- Migration 00123: Failed Submission Alerts, Attempt Tracking & Course Fallback
-- =============================================================================
-- Purpose:
-- 1. Extends public.incomplete_enrollments table with:
--    - submit_attempt_count INTEGER NOT NULL DEFAULT 0
--    - last_failed_submission_at TIMESTAMPTZ NULL
--    - failure_category TEXT NULL
-- 2. Updates capture_incomplete_enrollment_transaction RPC:
--    - Accepts p_status (default 'needs_followup')
--    - Accepts p_failure_category (default NULL)
--    - Accepts p_submit_attempt_count (default 1)
--    - Adds safe course resolution fallback (guarantees attempt is never dropped
--      if visitor submits before selecting a course)
--    - Records distinct attempt activity in public.lead_activities
--    - Supports repeated failed submission increments for same external_attempt_id
-- =============================================================================

-- 1. Extend public.incomplete_enrollments
ALTER TABLE public.incomplete_enrollments
  ADD COLUMN IF NOT EXISTS submit_attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_failed_submission_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS failure_category TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_incomplete_enrollments_last_failed
  ON public.incomplete_enrollments(last_failed_submission_at DESC)
  WHERE last_failed_submission_at IS NOT NULL;

-- 2. Update capture_incomplete_enrollment_transaction RPC
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

  -- 8. Lead Course Interest Handling
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
      lead_id, course_id, course_session_id, priority, created_at, updated_at
    ) VALUES (
      v_target_lead_id, v_resolved_course_id, v_resolved_session_id, v_slot, now(), now()
    );
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

REVOKE ALL ON FUNCTION public.capture_incomplete_enrollment_transaction(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.capture_incomplete_enrollment_transaction(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT
) TO service_role;
