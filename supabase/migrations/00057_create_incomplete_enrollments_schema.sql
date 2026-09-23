-- =============================================================================
-- Migration 00057: Create Incomplete Enrollments Schema & Session Recovery
-- =============================================================================
-- 1. Extends public.lead_activities.activity_type check constraint preserving
--    all 54 existing types and appending: 'incomplete_enrollment_captured',
--    'incomplete_enrollment_recovered', and 'incomplete_enrollment_dismissed'.
-- 2. Creates public.incomplete_enrollment_rate_limits table & check RPC with
--    persistent IP-hash windowing and opportunistic 24h cleanup.
-- 3. Creates public.incomplete_enrollments table with two-tier status architecture:
--    - processing_status: 'processed' | 'conflict'
--    - status: 'needs_followup' | 'recovered' | 'dismissed' (or NULL on conflict)
-- 4. Creates private capture_incomplete_enrollment_transaction RPC (service_role only).
-- 5. Creates dismiss_incomplete_enrollment RPC (authenticated only, cancels linked task).
-- 6. Creates trg_reconcile_incomplete_enrollment_on_confirm trigger on public.enrollments
--    with session-aware recovery and controlled null-session fallback.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Extend lead_activities.activity_type check constraint
-- -----------------------------------------------------------------------------
ALTER TABLE public.lead_activities
  DROP CONSTRAINT IF EXISTS lead_activities_activity_type_check;

ALTER TABLE public.lead_activities
  ADD CONSTRAINT lead_activities_activity_type_check
  CHECK (activity_type = ANY (ARRAY[
    -- Preserved byte-for-byte from migration 00056:
    'lead_created'::text, 'intake_received'::text, 'email_dispatched'::text, 
    'sms_dispatched'::text, 'call_task_created'::text, 'stage_changed'::text, 
    'processing_failed'::text, 'note_created'::text, 'tag_added'::text, 
    'tag_removed'::text, 'campaign_sent'::text, 'contact_preference_detected'::text, 
    'email_selected'::text, 'sms_selected'::text, 'call_selected'::text, 
    'channel_skipped'::text, 'csv_status_unmapped'::text, 'qualification_status_changed'::text,
    'form_submitted'::text, 'automation_started'::text, 'automation_completed'::text,
    'automation_failed'::text, 'sequence_started'::text, 'sequence_completed'::text, 
    'sequence_failed'::text, 'sequence_stopped'::text, 'email_reply_received'::text, 
    'sms_reply_received'::text, 'enrollment_created'::text, 'enrollment_confirmed'::text,
    'course_session_assigned'::text, 'course_session_changed'::text, 'attendance_recorded'::text, 
    'course_completed'::text, 'student_no_show'::text, 'checklist_item_updated'::text,
    'post_course_followup_created'::text, 'post_course_followup_completed'::text,
    'feedback_requested'::text, 'feedback_received'::text, 'testimonial_requested'::text,
    'testimonial_received'::text, 'future_course_interest_added'::text, 'task_created'::text,
    'task_rescheduled'::text, 'task_completed'::text,
    'hubspot_contact_linked'::text,
    'hubspot_field_updated'::text,
    'hubspot_outbound_synced'::text,
    'hubspot_sync_conflict'::text,
    'call_manual_attempt'::text,
    'whatsapp_contact_attempt'::text,
    'email_manual_attempt'::text,
    'sms_manual_attempt'::text,
    -- Batch 6 Activity Types:
    'incomplete_enrollment_captured'::text,
    'incomplete_enrollment_recovered'::text,
    'incomplete_enrollment_dismissed'::text
  ]));

COMMENT ON CONSTRAINT lead_activities_activity_type_check ON public.lead_activities IS
  'Allowed activity types including incomplete enrollment capture, recovery, and dismissal.';

-- -----------------------------------------------------------------------------
-- 2. Rate Limits Table & Function
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.incomplete_enrollment_rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_hash TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT incomplete_enrollment_rate_limits_key UNIQUE (ip_hash, window_start)
);

CREATE INDEX IF NOT EXISTS idx_incomplete_enrollment_rate_limits_window
  ON public.incomplete_enrollment_rate_limits(ip_hash, window_start);

ALTER TABLE public.incomplete_enrollment_rate_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny anon access on incomplete_enrollment_rate_limits" ON public.incomplete_enrollment_rate_limits;
CREATE POLICY "Deny anon access on incomplete_enrollment_rate_limits" ON public.incomplete_enrollment_rate_limits
  FOR ALL TO anon USING (false);

DROP POLICY IF EXISTS "Active app users can read incomplete_enrollment_rate_limits" ON public.incomplete_enrollment_rate_limits;
CREATE POLICY "Active app users can read incomplete_enrollment_rate_limits" ON public.incomplete_enrollment_rate_limits
  FOR SELECT TO authenticated
  USING (public.is_active_app_user());

DROP POLICY IF EXISTS "Service role full access on incomplete_enrollment_rate_limits" ON public.incomplete_enrollment_rate_limits;
CREATE POLICY "Service role full access on incomplete_enrollment_rate_limits" ON public.incomplete_enrollment_rate_limits
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.check_and_record_incomplete_enrollment_rate_limit(
  p_ip_hash TEXT,
  p_max_requests INT DEFAULT 10,
  p_window_minutes INT DEFAULT 10
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_current_count INT;
BEGIN
  -- Opportunistic cleanup of buckets older than 24 hours to keep table small without cron
  DELETE FROM public.incomplete_enrollment_rate_limits
  WHERE window_start < (now() - interval '24 hours');

  -- Bucket window start time based on p_window_minutes
  v_window_start := to_timestamp(floor(extract(epoch from now()) / (p_window_minutes * 60)) * (p_window_minutes * 60));

  INSERT INTO public.incomplete_enrollment_rate_limits (
    ip_hash, window_start, request_count, updated_at
  ) VALUES (
    p_ip_hash, v_window_start, 1, now()
  )
  ON CONFLICT (ip_hash, window_start)
  DO UPDATE SET 
    request_count = incomplete_enrollment_rate_limits.request_count + 1,
    updated_at = now()
  RETURNING request_count INTO v_current_count;

  RETURN v_current_count <= p_max_requests;
END;
$$;

REVOKE ALL ON FUNCTION public.check_and_record_incomplete_enrollment_rate_limit(TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_record_incomplete_enrollment_rate_limit(TEXT, INT, INT) TO service_role;

-- -----------------------------------------------------------------------------
-- 3. Incomplete Enrollments Core Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.incomplete_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  processing_status TEXT NOT NULL DEFAULT 'processed'
    CHECK (processing_status IN ('processed', 'conflict')),
  status TEXT NULL
    CHECK (status IS NULL OR status IN ('needs_followup', 'recovered', 'dismissed')),
  lead_id UUID NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE RESTRICT,
  course_session_id UUID NULL REFERENCES public.course_sessions(id) ON DELETE SET NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  external_attempt_id TEXT NULL,
  source_page TEXT NULL,
  utm_source TEXT NULL,
  utm_medium TEXT NULL,
  utm_campaign TEXT NULL,
  utm_term TEXT NULL,
  utm_content TEXT NULL,
  task_id UUID NULL REFERENCES public.tasks(id) ON DELETE SET NULL,
  resolved_enrollment_id UUID NULL REFERENCES public.enrollments(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_incomplete_enrollments_status_consistency CHECK (
    (processing_status = 'conflict' AND lead_id IS NULL AND status IS NULL) OR
    (processing_status = 'processed' AND lead_id IS NOT NULL AND status IS NOT NULL)
  )
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_incomplete_enrollments_external_attempt_id
  ON public.incomplete_enrollments(external_attempt_id);

CREATE INDEX IF NOT EXISTS idx_incomplete_enrollments_lead_course_status
  ON public.incomplete_enrollments(lead_id, course_id, status);

CREATE INDEX IF NOT EXISTS idx_incomplete_enrollments_session
  ON public.incomplete_enrollments(course_session_id);

CREATE INDEX IF NOT EXISTS idx_incomplete_enrollments_task_id
  ON public.incomplete_enrollments(task_id);

CREATE INDEX IF NOT EXISTS idx_incomplete_enrollments_created_at
  ON public.incomplete_enrollments(created_at DESC);

-- RLS
ALTER TABLE public.incomplete_enrollments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny anon access on incomplete_enrollments" ON public.incomplete_enrollments;
CREATE POLICY "Deny anon access on incomplete_enrollments" ON public.incomplete_enrollments
  FOR ALL TO anon USING (false);

DROP POLICY IF EXISTS "Active app users can read incomplete_enrollments" ON public.incomplete_enrollments;
CREATE POLICY "Active app users can read incomplete_enrollments" ON public.incomplete_enrollments
  FOR SELECT TO authenticated
  USING (public.is_active_app_user());

DROP POLICY IF EXISTS "Deny client direct update on incomplete_enrollments" ON public.incomplete_enrollments;
CREATE POLICY "Deny client direct update on incomplete_enrollments" ON public.incomplete_enrollments
  FOR UPDATE TO authenticated
  USING (false);

DROP POLICY IF EXISTS "Service role full access on incomplete_enrollments" ON public.incomplete_enrollments;
CREATE POLICY "Service role full access on incomplete_enrollments" ON public.incomplete_enrollments
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 4. Transactional Capture RPC (Private: service_role only)
-- -----------------------------------------------------------------------------
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
  v_slot INT;
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

  -- 6. Ambiguous Conflict Detection (Email matches Lead A, Phone matches Lead B)
  IF v_lead_by_email IS NOT NULL AND v_lead_by_phone IS NOT NULL AND v_lead_by_email != v_lead_by_phone THEN
    -- Identity conflict: Record attempt with lead_id = NULL, status = NULL, no task, no activities
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

  -- 8. Lead Course Interest Handling (Preserve Existing Sessions!)
  SELECT id, course_session_id INTO v_existing_interest
  FROM public.lead_course_interests
  WHERE lead_id = v_target_lead_id AND course_id = v_resolved_course_id
  LIMIT 1;

  IF FOUND THEN
    -- Only fill session if existing is NULL; do NOT overwrite an already chosen session
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

-- -----------------------------------------------------------------------------
-- 5. Operator Dismissal RPC (Authenticated App Users)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dismiss_incomplete_enrollment(
  p_incomplete_enrollment_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rec RECORD;
  v_caller_id UUID;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL OR NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: Caller is not an active application user.';
  END IF;

  SELECT id, lead_id, course_id, task_id, status INTO v_rec
  FROM public.incomplete_enrollments
  WHERE id = p_incomplete_enrollment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Incomplete enrollment with ID % not found.', p_incomplete_enrollment_id;
  END IF;

  IF v_rec.status = 'dismissed' THEN
    RETURN true;
  END IF;

  -- 1. Update status to dismissed
  UPDATE public.incomplete_enrollments
  SET status = 'dismissed', updated_at = now()
  WHERE id = p_incomplete_enrollment_id;

  -- 2. Cancel explicitly linked task if pending
  IF v_rec.task_id IS NOT NULL THEN
    UPDATE public.tasks
    SET status = 'cancelled', completed_at = now(), updated_at = now()
    WHERE id = v_rec.task_id AND status = 'pending';
  END IF;

  -- 3. Log lead activity
  IF v_rec.lead_id IS NOT NULL THEN
    INSERT INTO public.lead_activities (
      lead_id, activity_type, actor_type, summary, metadata
    ) VALUES (
      v_rec.lead_id, 'incomplete_enrollment_dismissed', 'user',
      'Alerta de inscrição incompleta dispensado pelo operador.',
      jsonb_build_object(
        'incomplete_enrollment_id', p_incomplete_enrollment_id,
        'course_id', v_rec.course_id,
        'reason', p_reason,
        'dismissed_by', v_caller_id
      )
    );
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.dismiss_incomplete_enrollment(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dismiss_incomplete_enrollment(UUID, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- 6. Session-Aware Recovery Trigger Function on public.enrollments
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_reconcile_incomplete_enrollment_on_confirm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rec RECORD;
BEGIN
  -- Triggered when an enrollment is inserted as confirmed or updated to confirmed
  IF (TG_OP = 'INSERT' AND NEW.enrollment_status = 'confirmed') OR
     (TG_OP = 'UPDATE' AND NEW.enrollment_status = 'confirmed' AND OLD.enrollment_status IS DISTINCT FROM 'confirmed') THEN

    FOR v_rec IN
      SELECT id, task_id, course_session_id
      FROM public.incomplete_enrollments
      WHERE lead_id = NEW.lead_id
        AND course_id = NEW.course_id
        AND status = 'needs_followup'
        AND (
          -- CASE A: Enrollment has course_session_id NOT NULL -> match same session OR generic null session
          (NEW.course_session_id IS NOT NULL AND (course_session_id = NEW.course_session_id OR course_session_id IS NULL))
          OR
          -- CASE B: Enrollment has course_session_id NULL -> controlled fallback course recovery
          (NEW.course_session_id IS NULL)
        )
    LOOP
      -- 1. Mark recovered
      UPDATE public.incomplete_enrollments
      SET status = 'recovered',
          resolved_enrollment_id = NEW.id,
          resolved_at = now(),
          updated_at = now()
      WHERE id = v_rec.id;

      -- 2. Complete ONLY the specifically linked task
      IF v_rec.task_id IS NOT NULL THEN
        UPDATE public.tasks
        SET status = 'completed', completed_at = now(), updated_at = now()
        WHERE id = v_rec.task_id AND status = 'pending';
      END IF;

      -- 3. Log recovery activity
      INSERT INTO public.lead_activities (
        lead_id, activity_type, actor_type, summary, metadata
      ) VALUES (
        NEW.lead_id, 'incomplete_enrollment_recovered', 'system',
        'Inscrição recuperada: matrícula confirmada no curso.',
        jsonb_build_object(
          'enrollment_id', NEW.id,
          'incomplete_enrollment_id', v_rec.id,
          'course_id', NEW.course_id,
          'course_session_id', NEW.course_session_id
        )
      );
    END LOOP;

  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enrollment_reconcile_incomplete ON public.enrollments;
CREATE TRIGGER trg_enrollment_reconcile_incomplete
AFTER INSERT OR UPDATE OF enrollment_status ON public.enrollments
FOR EACH ROW EXECUTE FUNCTION public.trg_reconcile_incomplete_enrollment_on_confirm();
