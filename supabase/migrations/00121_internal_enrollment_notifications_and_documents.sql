-- =============================================================================
-- Migration 00121: Internal Notifications (Incomplete & Contact Us) & Matrícula Hardening
-- =============================================================================
-- Purpose:
-- 1. Creates public.internal_notification_logs with inactivity tracking (last_activity_at,
--    scheduled_for) supporting 10-minute abandonment window and Contact Us notifications.
-- 2. Creates RPC get_internal_notification_recipients() to dynamically route internal
--    alerts to active internal EDS administrators.
-- 3. Configures pg_cron job to evaluate pending abandoned incomplete registrations every 5 min.
-- 4. Restores strict routine execution privileges on process_form_submission_transaction.
-- 5. Implements atomic public.save_lead_matricula_course_turma RPC to guarantee canonical
--    session resolution/reuse, lead_course_interests priority/source integrity, and enrollment sync.
-- 6. Remediates orphan or broken course_sessions data.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 1. Idempotency, Inactivity & Audit Table: public.internal_notification_logs
CREATE TABLE IF NOT EXISTS public.internal_notification_logs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type          TEXT NOT NULL CHECK (event_type IN ('incomplete_registration', 'contact_us')),
  idempotency_key     TEXT NOT NULL UNIQUE,
  lead_id             UUID NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  attempt_id          UUID NULL REFERENCES public.incomplete_enrollments(id) ON DELETE SET NULL,
  submission_id       UUID NULL REFERENCES public.form_submissions(id) ON DELETE SET NULL,
  recipient_emails    TEXT[] NOT NULL,
  subject             TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  provider_message_id TEXT NULL,
  error_message       TEXT NULL,
  payload_snapshot    JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_activity_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  scheduled_for       TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '10 minutes'),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at             TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_internal_notif_logs_idempotency ON public.internal_notification_logs(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_internal_notif_logs_lead_id ON public.internal_notification_logs(lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_internal_notif_logs_submission_id ON public.internal_notification_logs(submission_id) WHERE submission_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_internal_notif_logs_event_type ON public.internal_notification_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_internal_notif_logs_pending_sweep ON public.internal_notification_logs(status, scheduled_for) WHERE status = 'pending';

ALTER TABLE public.internal_notification_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "internal_notification_logs_auth_select" ON public.internal_notification_logs;
CREATE POLICY "internal_notification_logs_auth_select" ON public.internal_notification_logs
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "internal_notification_logs_service_role_all" ON public.internal_notification_logs;
CREATE POLICY "internal_notification_logs_service_role_all" ON public.internal_notification_logs
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- 2. Helper RPC: get_internal_notification_recipients
CREATE OR REPLACE FUNCTION public.get_internal_notification_recipients()
RETURNS TEXT[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_recipients TEXT[];
BEGIN
  SELECT ARRAY_AGG(DISTINCT email)
  INTO v_recipients
  FROM public.app_user
  WHERE is_active = true
    AND email IS NOT NULL
    AND trim(email) != '';

  IF v_recipients IS NULL OR array_length(v_recipients, 1) = 0 THEN
    v_recipients := ARRAY['info@expdentalsolutions.com']::TEXT[];
  END IF;

  RETURN v_recipients;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_internal_notification_recipients() TO authenticated, service_role;

-- 3. Routine execution security privileges for private process_form_submission_transaction
REVOKE EXECUTE ON FUNCTION public.process_form_submission_transaction(TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.process_form_submission_transaction(TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;

-- 4. Server-Side Abandonment Sweep Trigger Function (pg_net)
CREATE OR REPLACE FUNCTION public.trigger_process_incomplete_enrollment_emails()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN net.http_post(
    url := 'https://xogcexclqiornuscsdmn.supabase.co/functions/v1/send-internal-enrollment-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer sb_publishable_AyrxHrDnvNXwKvk1kBDqng_TgqHMPdw'
    ),
    body := jsonb_build_object(
      'action', 'process_pending_abandoned',
      'inactivity_minutes', 10
    )
  );
END;
$$;

-- 5. Schedule Inactivity Abandonment Sweep every 5 minutes
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-incomplete-enrollment-emails') THEN
    PERFORM cron.unschedule('process-incomplete-enrollment-emails');
  END IF;

  PERFORM cron.schedule(
    'process-incomplete-enrollment-emails',
    '*/5 * * * *',
    'SELECT public.trigger_process_incomplete_enrollment_emails();'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron schedule notice: %', SQLERRM;
END;
$$;

-- 6. Guarantee course_sessions date flexibility for label-only cohorts
ALTER TABLE public.course_sessions ALTER COLUMN start_date DROP NOT NULL;
ALTER TABLE public.course_sessions ALTER COLUMN end_date DROP NOT NULL;

-- 7. Atomic RPC: save_lead_matricula_course_turma
CREATE OR REPLACE FUNCTION public.save_lead_matricula_course_turma(
  p_lead_id UUID,
  p_course_id UUID,
  p_turma_label TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_course RECORD;
  v_session_id UUID := NULL;
  v_trimmed TEXT := trim(p_turma_label);
  v_enrollment_id UUID := NULL;
  v_interest_id UUID := NULL;
  v_clean_tag TEXT;
  v_code TEXT;
  v_user_id UUID;
BEGIN
  -- 1. Security Check
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: only active application users can save enrollment course and turma.';
  END IF;

  -- 2. Validate Lead
  IF NOT EXISTS (SELECT 1 FROM public.leads WHERE id = p_lead_id) THEN
    RAISE EXCEPTION 'Lead % not found.', p_lead_id;
  END IF;

  -- 3. Validate Course
  SELECT id, code, name, default_price, currency INTO v_course
  FROM public.courses
  WHERE id = p_course_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Course % not found.', p_course_id;
  END IF;

  -- 4. Resolve or create canonical course_session
  IF v_trimmed IS NOT NULL AND v_trimmed <> '' THEN
    -- If passed a UUID, resolve directly against existing course_sessions
    IF v_trimmed ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT id INTO v_session_id
      FROM public.course_sessions
      WHERE id = v_trimmed::UUID;
    ELSE
      -- Check if matching session exists for this course by exact human label (case-insensitive)
      SELECT id INTO v_session_id
      FROM public.course_sessions
      WHERE course_id = p_course_id
        AND lower(trim(title)) = lower(v_trimmed)
      ORDER BY created_at ASC
      LIMIT 1;

      -- If not found, create new session safely with null dates (never fake dates)
      IF v_session_id IS NULL THEN
        v_clean_tag := upper(regexp_replace(v_trimmed, '[^a-zA-Z0-9]', '', 'g'));
        IF v_clean_tag = '' THEN
          v_clean_tag := 'TURMA';
        END IF;
        v_code := COALESCE(v_course.code, 'CS') || '-' || v_clean_tag;

        IF EXISTS (SELECT 1 FROM public.course_sessions WHERE code = v_code) THEN
          v_code := v_code || '-' || substr(md5(random()::text), 1, 4);
        END IF;

        -- Safe auth user resolution
        SELECT id INTO v_user_id FROM auth.users WHERE id = auth.uid();

        INSERT INTO public.course_sessions (
          course_id, code, title, status, start_date, end_date, timezone, location, created_by_user_id
        ) VALUES (
          p_course_id, v_code, v_trimmed, 'open', NULL, NULL, 'America/New_York', 'Orlando, FL', v_user_id
        ) RETURNING id INTO v_session_id;
      END IF;
    END IF;
  END IF;

  -- 5. Update lead course_interest name
  UPDATE public.leads
  SET course_interest = v_course.name,
      updated_at = now()
  WHERE id = p_lead_id;

  -- 6. Upsert lead_course_interests safely respecting unique (lead_id, course_id)
  SELECT id INTO v_interest_id
  FROM public.lead_course_interests
  WHERE lead_id = p_lead_id AND course_id = p_course_id
  LIMIT 1;

  IF v_interest_id IS NOT NULL THEN
    -- Demote other priority 1 if necessary
    UPDATE public.lead_course_interests
    SET priority = 2
    WHERE lead_id = p_lead_id AND priority = 1 AND id <> v_interest_id;

    UPDATE public.lead_course_interests
    SET course_session_id = v_session_id,
        priority = 1,
        status = 'active',
        updated_at = now()
    WHERE id = v_interest_id;
  ELSE
    -- Demote any current priority 1
    UPDATE public.lead_course_interests
    SET priority = 2
    WHERE lead_id = p_lead_id AND priority = 1;

    INSERT INTO public.lead_course_interests (
      lead_id, course_id, course_session_id, priority, source, status, created_at, updated_at
    ) VALUES (
      p_lead_id, p_course_id, v_session_id, 1, 'manual', 'active', now(), now()
    ) RETURNING id INTO v_interest_id;
  END IF;

  -- 7. Upsert enrollment row
  SELECT id INTO v_enrollment_id
  FROM public.enrollments
  WHERE lead_id = p_lead_id
  LIMIT 1;

  IF v_enrollment_id IS NOT NULL THEN
    UPDATE public.enrollments
    SET course_id = p_course_id,
        course_session_id = v_session_id,
        course_name_snapshot = v_course.name,
        updated_at = now()
    WHERE id = v_enrollment_id;
  ELSE
    SELECT id INTO v_user_id FROM auth.users WHERE id = auth.uid();
    INSERT INTO public.enrollments (
      lead_id,
      course_id,
      course_session_id,
      course_name_snapshot,
      enrollment_status,
      agreed_amount,
      currency,
      enrollment_date,
      source,
      idempotency_key,
      created_by_user_id
    ) VALUES (
      p_lead_id,
      p_course_id,
      v_session_id,
      v_course.name,
      'confirmed',
      COALESCE(v_course.default_price, 0.00),
      COALESCE(v_course.currency, 'USD'),
      CURRENT_DATE,
      'manual',
      'enrollment_' || p_lead_id || '_' || p_course_id,
      v_user_id
    ) RETURNING id INTO v_enrollment_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'lead_id', p_lead_id,
    'course_id', p_course_id,
    'course_name', v_course.name,
    'course_session_id', v_session_id,
    'turma_title', v_trimmed,
    'enrollment_id', v_enrollment_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_lead_matricula_course_turma(UUID, UUID, TEXT) TO authenticated, service_role;

-- 8. Data remediation: Cleanup orphan/UUID course_sessions and ensure source consistency
DO $$
DECLARE
  r RECORD;
  v_canonical_id UUID;
BEGIN
  -- 8a. Remap any UUID-titled sessions to a legitimate session of the same course
  FOR r IN
    SELECT id, course_id
    FROM public.course_sessions
    WHERE title ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  LOOP
    SELECT id INTO v_canonical_id
    FROM public.course_sessions
    WHERE course_id = r.course_id
      AND id <> r.id
      AND title !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_canonical_id IS NOT NULL THEN
      UPDATE public.enrollments SET course_session_id = v_canonical_id WHERE course_session_id = r.id;
      UPDATE public.lead_course_interests SET course_session_id = v_canonical_id WHERE course_session_id = r.id;
      DELETE FROM public.course_sessions WHERE id = r.id;
    END IF;
  END LOOP;

  -- 8b. Ensure lead_course_interests source is populated
  UPDATE public.lead_course_interests SET source = 'manual' WHERE source IS NULL;
END;
$$;
