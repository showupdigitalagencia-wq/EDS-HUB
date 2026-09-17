-- =============================================================================
-- Migration 00036: Course Operations & Student Lifecycle (Phase 4 Block 4)
-- =============================================================================
-- Implements:
-- 1. course_sessions table (turmas, scheduling, timezone, capacity, canonical status)
-- 2. enrollments.course_session_id linkage
-- 3. course_participations table (attendance, completion status, strictly 1:1 with enrollment)
-- 4. course_checklist_templates table (reusable pre-course operational requirements)
-- 5. student_checklist_items table (snapshot instances per assigned enrollment)
-- 6. app_settings extensions (course_readiness_window_days, post_course_followup_due_days)
-- 7. Activity & stage constraints extension
-- 8. Automation triggers & events extension
-- 9. Performance indexes & RLS policies
-- 10. Transactional RPCs:
--     - assign_enrollment_to_session
--     - change_enrollment_session
--     - record_course_attendance
--     - record_course_completion
--     - update_student_checklist_item
--     - evaluate_lead_post_course_transition
--     - get_course_operations_dashboard
--     - get_course_session_detail
--     - create_or_update_course_session
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. App Settings Extensions for Operational Windows
-- -----------------------------------------------------------------------------
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS course_readiness_window_days INT NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS post_course_followup_due_days INT NOT NULL DEFAULT 2;

-- -----------------------------------------------------------------------------
-- 2. Extend Activity & Stage History Constraints
-- -----------------------------------------------------------------------------
ALTER TABLE public.lead_stage_history
  DROP CONSTRAINT IF EXISTS lead_stage_history_change_reason_check;

ALTER TABLE public.lead_stage_history
  ADD CONSTRAINT lead_stage_history_change_reason_check
  CHECK (change_reason IN (
    'initial_assignment',
    'auto_after_intake',
    'manual',
    'csv_import_stage_mapping',
    'enrollment_confirmed',
    'course_completed',
    'post_course_transition'
  ));

ALTER TABLE public.lead_activities
  DROP CONSTRAINT IF EXISTS lead_activities_activity_type_check;

ALTER TABLE public.lead_activities
  ADD CONSTRAINT lead_activities_activity_type_check
  CHECK (activity_type = ANY (ARRAY[
    'lead_created'::text, 'intake_received'::text, 'email_dispatched'::text, 
    'sms_dispatched'::text, 'call_task_created'::text, 'stage_changed'::text, 
    'processing_failed'::text, 'note_created'::text, 'tag_added'::text, 
    'tag_removed'::text, 'campaign_sent'::text, 'contact_preference_detected'::text, 
    'email_selected'::text, 'sms_selected'::text, 'call_selected'::text, 
    'channel_skipped'::text, 'csv_status_unmapped'::text, 'qualification_status_changed'::text,
    'form_submitted'::text, 'automation_started'::text, 'automation_completed'::text,
    'automation_failed'::text,
    'sequence_started'::text, 'sequence_completed'::text, 'sequence_failed'::text, 'sequence_stopped'::text,
    'email_reply_received'::text, 'sms_reply_received'::text,
    'enrollment_created'::text, 'enrollment_confirmed'::text,
    'course_session_assigned'::text, 'course_session_changed'::text,
    'attendance_recorded'::text, 'course_completed'::text,
    'student_no_show'::text, 'checklist_item_updated'::text
  ]));

-- Extend automation trigger and event types
ALTER TABLE public.automations
  DROP CONSTRAINT IF EXISTS automations_trigger_type_check;

ALTER TABLE public.automations
  ADD CONSTRAINT automations_trigger_type_check
  CHECK (trigger_type IN (
    'form_submitted', 'lead_created', 'qualification_status_changed',
    'pipeline_stage_changed', 'tag_added', 'manual_enrollment',
    'course_session_assigned', 'course_session_changed',
    'attendance_recorded', 'course_completed', 'student_no_show'
  ));

ALTER TABLE public.automation_events
  DROP CONSTRAINT IF EXISTS automation_events_event_type_check;

ALTER TABLE public.automation_events
  ADD CONSTRAINT automation_events_event_type_check
  CHECK (event_type IN (
    'form_submitted', 'lead_created', 'qualification_status_changed',
    'pipeline_stage_changed', 'tag_added', 'manual_enrollment',
    'course_session_assigned', 'course_session_changed',
    'attendance_recorded', 'course_completed', 'student_no_show'
  ));

-- -----------------------------------------------------------------------------
-- 3. Course Sessions Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.course_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE RESTRICT,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' 
    CHECK (status IN ('draft', 'open', 'confirmed', 'completed', 'cancelled')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  capacity INT NULL CHECK (capacity IS NULL OR capacity > 0),
  location TEXT NULL DEFAULT 'Orlando, FL',
  instructor_name TEXT NULL,
  notes TEXT NULL,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_course_sessions_dates CHECK (end_date >= start_date)
);

-- -----------------------------------------------------------------------------
-- 4. Enrollments Linkage to Course Sessions
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'enrollments' AND column_name = 'course_session_id'
  ) THEN
    ALTER TABLE public.enrollments
      ADD COLUMN course_session_id UUID NULL REFERENCES public.course_sessions(id) ON DELETE SET NULL;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 5. Course Participations Table (Strictly 1:1 with Enrollment)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.course_participations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID NOT NULL UNIQUE REFERENCES public.enrollments(id) ON DELETE CASCADE,
  course_session_id UUID NOT NULL REFERENCES public.course_sessions(id) ON DELETE RESTRICT,
  attendance_status TEXT NOT NULL DEFAULT 'expected'
    CHECK (attendance_status IN ('expected', 'attended', 'no_show', 'cancelled')),
  completion_status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (completion_status IN ('not_started', 'completed', 'incomplete')),
  completed_at TIMESTAMPTZ NULL,
  completed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 6. Checklist Templates & Student Checklist Items
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.course_checklist_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NULL,
  required BOOLEAN NOT NULL DEFAULT true,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.student_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID NOT NULL REFERENCES public.enrollments(id) ON DELETE CASCADE,
  course_session_id UUID NOT NULL REFERENCES public.course_sessions(id) ON DELETE CASCADE,
  template_id UUID NULL REFERENCES public.course_checklist_templates(id) ON DELETE SET NULL,
  title_snapshot TEXT NOT NULL,
  required BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'waived')),
  completed_at TIMESTAMPTZ NULL,
  completed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_student_checklist_template UNIQUE (enrollment_id, template_id)
);

-- Seed Canonical EDS Checklist Templates
INSERT INTO public.course_checklist_templates (course_id, title, description, required, active, sort_order)
VALUES
  (NULL, 'Medical Clearance & Malpractice Insurance', 'Valid dental license and proof of malpractice coverage submitted', true, true, 1),
  (NULL, 'Travel & Accommodation Details', 'Flight itinerary and hotel reservations confirmed', false, true, 2),
  (NULL, 'Clinical Prerequisite Verification', 'Pre-course online materials and case review completion verified', true, true, 3),
  (NULL, 'Surgical Scrub & Glove Sizing', 'Clinical sizing preference confirmed for hands-on surgical labs', true, true, 4)
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- 7. Performance Indexes
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_course_sessions_course_dates ON public.course_sessions(course_id, start_date);
CREATE INDEX IF NOT EXISTS idx_course_sessions_status_dates ON public.course_sessions(status, start_date);
CREATE INDEX IF NOT EXISTS idx_enrollments_session_id ON public.enrollments(course_session_id);
CREATE INDEX IF NOT EXISTS idx_course_participations_enrollment ON public.course_participations(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_course_participations_session_completion ON public.course_participations(course_session_id, completion_status);
CREATE INDEX IF NOT EXISTS idx_course_participations_attendance ON public.course_participations(attendance_status);
CREATE INDEX IF NOT EXISTS idx_student_checklist_enrollment_status ON public.student_checklist_items(enrollment_id, status);
CREATE INDEX IF NOT EXISTS idx_student_checklist_session ON public.student_checklist_items(course_session_id);
CREATE INDEX IF NOT EXISTS idx_course_checklist_templates_course ON public.course_checklist_templates(course_id, active, sort_order);

-- -----------------------------------------------------------------------------
-- 8. Row Level Security (RLS)
-- -----------------------------------------------------------------------------
ALTER TABLE public.course_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_participations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_checklist_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_checklist_items ENABLE ROW LEVEL SECURITY;

-- course_sessions
DROP POLICY IF EXISTS "course_sessions_select_active" ON public.course_sessions;
CREATE POLICY "course_sessions_select_active" ON public.course_sessions
  FOR SELECT TO authenticated USING (public.is_active_app_user());

DROP POLICY IF EXISTS "course_sessions_all_active" ON public.course_sessions;
CREATE POLICY "course_sessions_all_active" ON public.course_sessions
  FOR ALL TO authenticated USING (public.is_active_app_user()) WITH CHECK (public.is_active_app_user());

-- course_participations
DROP POLICY IF EXISTS "course_participations_select_active" ON public.course_participations;
CREATE POLICY "course_participations_select_active" ON public.course_participations
  FOR SELECT TO authenticated USING (public.is_active_app_user());

DROP POLICY IF EXISTS "course_participations_all_active" ON public.course_participations;
CREATE POLICY "course_participations_all_active" ON public.course_participations
  FOR ALL TO authenticated USING (public.is_active_app_user()) WITH CHECK (public.is_active_app_user());

-- course_checklist_templates
DROP POLICY IF EXISTS "course_checklist_templates_select_active" ON public.course_checklist_templates;
CREATE POLICY "course_checklist_templates_select_active" ON public.course_checklist_templates
  FOR SELECT TO authenticated USING (public.is_active_app_user());

DROP POLICY IF EXISTS "course_checklist_templates_all_active" ON public.course_checklist_templates;
CREATE POLICY "course_checklist_templates_all_active" ON public.course_checklist_templates
  FOR ALL TO authenticated USING (public.is_active_app_user()) WITH CHECK (public.is_active_app_user());

-- student_checklist_items
DROP POLICY IF EXISTS "student_checklist_items_select_active" ON public.student_checklist_items;
CREATE POLICY "student_checklist_items_select_active" ON public.student_checklist_items
  FOR SELECT TO authenticated USING (public.is_active_app_user());

DROP POLICY IF EXISTS "student_checklist_items_all_active" ON public.student_checklist_items;
CREATE POLICY "student_checklist_items_all_active" ON public.student_checklist_items
  FOR ALL TO authenticated USING (public.is_active_app_user()) WITH CHECK (public.is_active_app_user());

-- -----------------------------------------------------------------------------
-- 9. Helper Function: Validate IANA Timezone
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_valid_timezone(p_tz TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_tz IS NULL OR trim(p_tz) = '' THEN
    RETURN false;
  END IF;
  
  -- Check against pg_timezone_names
  PERFORM 1 FROM pg_timezone_names WHERE name = p_tz;
  RETURN FOUND;
END;
$$;

-- -----------------------------------------------------------------------------
-- 10. RPC: create_or_update_course_session
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_or_update_course_session(
  p_session_id UUID DEFAULT NULL,
  p_course_id UUID DEFAULT NULL,
  p_code TEXT DEFAULT NULL,
  p_title TEXT DEFAULT NULL,
  p_status TEXT DEFAULT 'open',
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL,
  p_timezone TEXT DEFAULT 'America/New_York',
  p_capacity INT DEFAULT NULL,
  p_location TEXT DEFAULT 'Orlando, FL',
  p_instructor_name TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_id UUID := p_session_id;
  v_course RECORD;
  v_old_status TEXT;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: only active application users can manage course sessions.';
  END IF;

  -- Validate Timezone
  IF NOT public.is_valid_timezone(p_timezone) THEN
    RAISE EXCEPTION 'Invalid timezone identifier: %. Must be a valid IANA timezone name (e.g. America/New_York).', p_timezone;
  END IF;

  -- Validate Dates
  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'Session start_date and end_date are required.';
  END IF;

  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'end_date (%) cannot be earlier than start_date (%).', p_end_date, p_start_date;
  END IF;

  -- Validate Status
  IF p_status NOT IN ('draft', 'open', 'confirmed', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid session status: %. Must be draft, open, confirmed, completed, or cancelled.', p_status;
  END IF;

  -- Validate Capacity
  IF p_capacity IS NOT NULL AND p_capacity <= 0 THEN
    RAISE EXCEPTION 'Session capacity must be greater than zero when specified.';
  END IF;

  IF v_session_id IS NULL THEN
    -- Validate Course
    SELECT id, name INTO v_course FROM public.courses WHERE id = p_course_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Course % not found.', p_course_id;
    END IF;

    IF p_code IS NULL OR trim(p_code) = '' THEN
      RAISE EXCEPTION 'Session code is required.';
    END IF;

    IF p_title IS NULL OR trim(p_title) = '' THEN
      RAISE EXCEPTION 'Session title is required.';
    END IF;

    INSERT INTO public.course_sessions (
      course_id, code, title, status, start_date, end_date, timezone, capacity, location, instructor_name, notes, created_by_user_id
    ) VALUES (
      p_course_id, trim(p_code), trim(p_title), p_status, p_start_date, p_end_date, p_timezone, p_capacity, p_location, p_instructor_name, p_notes, auth.uid()
    ) RETURNING id INTO v_session_id;
  ELSE
    SELECT status INTO v_old_status FROM public.course_sessions WHERE id = v_session_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Session % not found.', v_session_id;
    END IF;

    UPDATE public.course_sessions
    SET
      title = COALESCE(trim(p_title), title),
      code = COALESCE(trim(p_code), code),
      status = COALESCE(p_status, status),
      start_date = COALESCE(p_start_date, start_date),
      end_date = COALESCE(p_end_date, end_date),
      timezone = COALESCE(p_timezone, timezone),
      capacity = p_capacity,
      location = COALESCE(p_location, location),
      instructor_name = p_instructor_name,
      notes = p_notes,
      updated_at = now()
    WHERE id = v_session_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'session_id', v_session_id
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 11. RPC: assign_enrollment_to_session (Transactional & Idempotent)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_enrollment_to_session(
  p_enrollment_id UUID,
  p_session_id UUID,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_enrollment RECORD;
  v_session RECORD;
  v_existing_part RECORD;
  v_tpl RECORD;
  v_template_count INT := 0;
  v_created_items INT := 0;
BEGIN
  -- 1. Security check
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: only active application users can assign enrollments.';
  END IF;
  v_actor_id := auth.uid();

  -- 2. Validate Enrollment
  SELECT * INTO v_enrollment FROM public.enrollments WHERE id = p_enrollment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Enrollment % not found.', p_enrollment_id;
  END IF;

  IF v_enrollment.enrollment_status = 'cancelled' THEN
    RAISE EXCEPTION 'Cannot assign a cancelled enrollment to a session.';
  END IF;

  -- 3. Validate Session
  SELECT * INTO v_session FROM public.course_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Course session % not found.', p_session_id;
  END IF;

  IF v_session.status = 'cancelled' THEN
    RAISE EXCEPTION 'Cannot assign enrollment to a cancelled course session.';
  END IF;

  -- 4. Validate Course Match
  IF v_enrollment.course_id <> v_session.course_id THEN
    RAISE EXCEPTION 'Course mismatch: enrollment course (%) does not match session course (%).', 
      v_enrollment.course_id, v_session.course_id;
  END IF;

  -- 5. Check if already assigned to this exact session
  IF v_enrollment.course_session_id = p_session_id THEN
    SELECT * INTO v_existing_part FROM public.course_participations WHERE enrollment_id = p_enrollment_id;
    IF FOUND AND v_existing_part.course_session_id = p_session_id THEN
      RETURN jsonb_build_object(
        'success', true,
        'enrollment_id', p_enrollment_id,
        'session_id', p_session_id,
        'idempotent_replay', true,
        'message', 'Enrollment already assigned to this session.'
      );
    END IF;
  END IF;

  -- 6. Update Enrollment
  UPDATE public.enrollments
  SET course_session_id = p_session_id,
      updated_at = now()
  WHERE id = p_enrollment_id;

  -- 7. Upsert Participation (Ensures strict 1:1 with enrollment)
  INSERT INTO public.course_participations (
    enrollment_id,
    course_session_id,
    attendance_status,
    completion_status,
    notes
  ) VALUES (
    p_enrollment_id,
    p_session_id,
    'expected',
    'not_started',
    'Assigned via assign_enrollment_to_session'
  )
  ON CONFLICT (enrollment_id) DO UPDATE
  SET
    course_session_id = EXCLUDED.course_session_id,
    updated_at = now();

  -- 8. Instantiate Checklist Items from Templates (Snapshot Integrity)
  FOR v_tpl IN
    SELECT * FROM public.course_checklist_templates
    WHERE active = true
      AND (course_id IS NULL OR course_id = v_session.course_id)
    ORDER BY sort_order ASC
  LOOP
    v_template_count := v_template_count + 1;
    
    INSERT INTO public.student_checklist_items (
      enrollment_id,
      course_session_id,
      template_id,
      title_snapshot,
      required,
      status
    ) VALUES (
      p_enrollment_id,
      p_session_id,
      v_tpl.id,
      v_tpl.title,
      v_tpl.required,
      'pending'
    )
    ON CONFLICT (enrollment_id, template_id) DO UPDATE
    SET course_session_id = EXCLUDED.course_session_id;

    v_created_items := v_created_items + 1;
  END LOOP;

  -- 9. Log Activity (Idempotent per assignment transaction)
  INSERT INTO public.lead_activities (
    lead_id,
    activity_type,
    actor_type,
    actor_id,
    summary,
    metadata
  ) VALUES (
    v_enrollment.lead_id,
    'course_session_assigned',
    'user',
    v_actor_id,
    'Student assigned to session ' || v_session.code || ' (' || v_session.title || ')',
    jsonb_build_object(
      'enrollment_id', p_enrollment_id,
      'session_id', p_session_id,
      'session_code', v_session.code,
      'session_title', v_session.title,
      'start_date', v_session.start_date,
      'end_date', v_session.end_date,
      'idempotency_key', p_idempotency_key
    )
  );

  -- 10. Emit Automation Event
  INSERT INTO public.automation_events (
    event_type,
    lead_id,
    payload
  ) VALUES (
    'course_session_assigned',
    v_enrollment.lead_id,
    jsonb_build_object(
      'enrollment_id', p_enrollment_id,
      'course_id', v_session.course_id,
      'session_id', p_session_id,
      'session_code', v_session.code,
      'start_date', v_session.start_date,
      'end_date', v_session.end_date
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'enrollment_id', p_enrollment_id,
    'session_id', p_session_id,
    'checklist_items_created', v_created_items,
    'idempotent_replay', false
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 12. RPC: change_enrollment_session (Transfer to Another Session)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.change_enrollment_session(
  p_enrollment_id UUID,
  p_new_session_id UUID,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_enrollment RECORD;
  v_old_session RECORD;
  v_new_session RECORD;
  v_old_session_id UUID;
BEGIN
  -- Security check
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: only active application users can transfer sessions.';
  END IF;
  v_actor_id := auth.uid();

  -- Validate Enrollment
  SELECT * INTO v_enrollment FROM public.enrollments WHERE id = p_enrollment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Enrollment % not found.', p_enrollment_id;
  END IF;

  v_old_session_id := v_enrollment.course_session_id;

  -- Validate New Session
  SELECT * INTO v_new_session FROM public.course_sessions WHERE id = p_new_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target course session % not found.', p_new_session_id;
  END IF;

  IF v_new_session.status = 'cancelled' THEN
    RAISE EXCEPTION 'Cannot transfer student to a cancelled course session.';
  END IF;

  -- Validate Course Match
  IF v_enrollment.course_id <> v_new_session.course_id THEN
    RAISE EXCEPTION 'Course mismatch: enrollment course (%) does not match target session course (%).',
      v_enrollment.course_id, v_new_session.course_id;
  END IF;

  -- If same session, return idempotently
  IF v_old_session_id = p_new_session_id THEN
    RETURN jsonb_build_object(
      'success', true,
      'enrollment_id', p_enrollment_id,
      'session_id', p_new_session_id,
      'idempotent_replay', true,
      'message', 'Enrollment already assigned to target session.'
    );
  END IF;

  -- Fetch old session details if existed
  IF v_old_session_id IS NOT NULL THEN
    SELECT * INTO v_old_session FROM public.course_sessions WHERE id = v_old_session_id;
  END IF;

  -- Update Enrollment
  UPDATE public.enrollments
  SET course_session_id = p_new_session_id,
      updated_at = now()
  WHERE id = p_enrollment_id;

  -- Update Participation (Strictly maintains 1:1, re-associating to new session)
  UPDATE public.course_participations
  SET course_session_id = p_new_session_id,
      notes = COALESCE(notes, '') || ' [Transferred from session ' || COALESCE(v_old_session.code, 'none') || ' on ' || now()::date || ']',
      updated_at = now()
  WHERE enrollment_id = p_enrollment_id;

  -- Re-link existing checklist items to new session
  UPDATE public.student_checklist_items
  SET course_session_id = p_new_session_id,
      updated_at = now()
  WHERE enrollment_id = p_enrollment_id;

  -- Log Activity
  INSERT INTO public.lead_activities (
    lead_id,
    activity_type,
    actor_type,
    actor_id,
    summary,
    metadata
  ) VALUES (
    v_enrollment.lead_id,
    'course_session_changed',
    'user',
    v_actor_id,
    'Student session changed from ' || COALESCE(v_old_session.code, 'Unassigned') || ' to ' || v_new_session.code,
    jsonb_build_object(
      'enrollment_id', p_enrollment_id,
      'old_session_id', v_old_session_id,
      'old_session_code', v_old_session.code,
      'new_session_id', p_new_session_id,
      'new_session_code', v_new_session.code,
      'idempotency_key', p_idempotency_key,
      'changed_at', now(),
      'changed_by', v_actor_id
    )
  );

  -- Emit Automation Event
  INSERT INTO public.automation_events (
    event_type,
    lead_id,
    payload
  ) VALUES (
    'course_session_changed',
    v_enrollment.lead_id,
    jsonb_build_object(
      'enrollment_id', p_enrollment_id,
      'old_session_id', v_old_session_id,
      'new_session_id', p_new_session_id,
      'new_session_code', v_new_session.code
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'enrollment_id', p_enrollment_id,
    'old_session_id', v_old_session_id,
    'new_session_id', p_new_session_id,
    'idempotent_replay', false
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 13. Safe Server-Side Post-Course Pipeline Evaluator
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.evaluate_lead_post_course_transition(p_lead_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead RECORD;
  v_current_stage_code TEXT;
  v_post_course_stage_id UUID;
  v_confirmed_count INT := 0;
  v_unassigned_count INT := 0;
  v_active_or_future_session_count INT := 0;
  v_incomplete_count INT := 0;
  v_future_session_count INT := 0;
  v_blocker_reason TEXT := NULL;
BEGIN
  -- 1. Fetch Lead & Current Stage
  SELECT l.*, s.code AS stage_code
  INTO v_lead
  FROM public.leads l
  JOIN public.pipeline_stages s ON s.id = l.pipeline_stage_id
  WHERE l.id = p_lead_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead % not found.', p_lead_id;
  END IF;

  v_current_stage_code := v_lead.stage_code;

  -- Only leads currently in 'enrollment' stage can move forward to post_course
  IF v_current_stage_code <> 'enrollment' THEN
    RETURN jsonb_build_object(
      'eligible', false,
      'moved', false,
      'current_stage', v_current_stage_code,
      'reason', 'Lead is not currently in enrollment stage.'
    );
  END IF;

  -- 2. Fetch Post Course Stage ID
  SELECT id INTO v_post_course_stage_id FROM public.pipeline_stages WHERE code = 'post_course';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pipeline stage post_course not found.';
  END IF;

  -- 3. Check All Confirmed Enrollments for this lead
  SELECT count(*) INTO v_confirmed_count
  FROM public.enrollments
  WHERE lead_id = p_lead_id AND enrollment_status = 'confirmed';

  IF v_confirmed_count = 0 THEN
    RETURN jsonb_build_object(
      'eligible', false,
      'moved', false,
      'current_stage', v_current_stage_code,
      'reason', 'No confirmed enrollments found for this lead.'
    );
  END IF;

  -- Condition A: Any confirmed enrollment has course_session_id IS NULL
  SELECT count(*) INTO v_unassigned_count
  FROM public.enrollments
  WHERE lead_id = p_lead_id
    AND enrollment_status = 'confirmed'
    AND course_session_id IS NULL;

  IF v_unassigned_count > 0 THEN
    v_blocker_reason := 'Confirmed enrollment exists without assigned course session.';
  END IF;

  -- Condition B: course_session.status IN ('draft', 'open', 'confirmed') AND session.end_date >= CURRENT_DATE
  IF v_blocker_reason IS NULL THEN
    SELECT count(*) INTO v_active_or_future_session_count
    FROM public.enrollments e
    JOIN public.course_sessions s ON s.id = e.course_session_id
    WHERE e.lead_id = p_lead_id
      AND e.enrollment_status = 'confirmed'
      AND s.status IN ('draft', 'open', 'confirmed')
      AND s.end_date >= CURRENT_DATE;

    IF v_active_or_future_session_count > 0 THEN
      v_blocker_reason := 'Active or ongoing course session in progress.';
    END IF;
  END IF;

  -- Condition C: participation.completion_status != 'completed'
  IF v_blocker_reason IS NULL THEN
    SELECT count(*) INTO v_incomplete_count
    FROM public.enrollments e
    LEFT JOIN public.course_participations p ON p.enrollment_id = e.id
    WHERE e.lead_id = p_lead_id
      AND e.enrollment_status = 'confirmed'
      AND (p.id IS NULL OR p.completion_status <> 'completed');

    IF v_incomplete_count > 0 THEN
      v_blocker_reason := 'One or more confirmed enrollments are not yet marked completed.';
    END IF;
  END IF;

  -- Condition D: Another confirmed enrollment with a future session
  IF v_blocker_reason IS NULL THEN
    SELECT count(*) INTO v_future_session_count
    FROM public.enrollments e
    JOIN public.course_sessions s ON s.id = e.course_session_id
    WHERE e.lead_id = p_lead_id
      AND e.enrollment_status = 'confirmed'
      AND s.start_date > CURRENT_DATE;

    IF v_future_session_count > 0 THEN
      v_blocker_reason := 'Another confirmed enrollment has a future session.';
    END IF;
  END IF;

  -- If any open academic context remains: DO NOT MOVE
  IF v_blocker_reason IS NOT NULL THEN
    RETURN jsonb_build_object(
      'eligible', false,
      'moved', false,
      'current_stage', v_current_stage_code,
      'reason', v_blocker_reason
    );
  END IF;

  -- 4. Safe Idempotent Stage Move to post_course
  UPDATE public.leads
  SET pipeline_stage_id = v_post_course_stage_id,
      updated_at = now()
  WHERE id = p_lead_id;

  -- Insert Stage History
  INSERT INTO public.lead_stage_history (
    lead_id,
    from_stage_id,
    to_stage_id,
    change_reason,
    actor_type,
    actor_id
  ) VALUES (
    p_lead_id,
    v_lead.pipeline_stage_id,
    v_post_course_stage_id,
    'course_completed',
    'system',
    auth.uid()
  );

  -- Insert Activity
  INSERT INTO public.lead_activities (
    lead_id,
    activity_type,
    actor_type,
    actor_id,
    summary,
    metadata
  ) VALUES (
    p_lead_id,
    'stage_changed',
    'system',
    auth.uid(),
    'Lead advanced to Post-Course stage following completion of all academic commitments.',
    jsonb_build_object(
      'from_stage', v_current_stage_code,
      'to_stage', 'post_course',
      'reason', 'course_completed'
    )
  );

  -- Emit Automation Event
  INSERT INTO public.automation_events (
    event_type,
    lead_id,
    payload
  ) VALUES (
    'pipeline_stage_changed',
    p_lead_id,
    jsonb_build_object(
      'from_stage', v_current_stage_code,
      'to_stage', 'post_course',
      'reason', 'course_completed'
    )
  );

  RETURN jsonb_build_object(
    'eligible', true,
    'moved', true,
    'current_stage', 'post_course',
    'message', 'Lead safely advanced to post_course.'
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 14. RPC: record_course_attendance
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_course_attendance(
  p_enrollment_id UUID,
  p_attendance_status TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_enrollment RECORD;
  v_session RECORD;
  v_part RECORD;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: only active application users can record attendance.';
  END IF;
  v_actor_id := auth.uid();

  IF p_attendance_status NOT IN ('expected', 'attended', 'no_show', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid attendance status: %. Must be expected, attended, no_show, or cancelled.', p_attendance_status;
  END IF;

  SELECT * INTO v_enrollment FROM public.enrollments WHERE id = p_enrollment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Enrollment % not found.', p_enrollment_id;
  END IF;

  SELECT * INTO v_part FROM public.course_participations WHERE enrollment_id = p_enrollment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Course participation not found for enrollment %. Assign to session first.', p_enrollment_id;
  END IF;

  SELECT * INTO v_session FROM public.course_sessions WHERE id = v_part.course_session_id;

  -- Update Participation
  UPDATE public.course_participations
  SET
    attendance_status = p_attendance_status,
    notes = COALESCE(p_notes, notes),
    updated_at = now()
  WHERE enrollment_id = p_enrollment_id;

  -- Log Activity & Automation
  IF p_attendance_status = 'no_show' THEN
    INSERT INTO public.lead_activities (
      lead_id, activity_type, actor_type, actor_id, summary, metadata
    ) VALUES (
      v_enrollment.lead_id,
      'student_no_show',
      'user',
      v_actor_id,
      'Student marked as NO SHOW for session ' || COALESCE(v_session.code, ''),
      jsonb_build_object('enrollment_id', p_enrollment_id, 'session_id', v_part.course_session_id, 'notes', p_notes)
    );

    INSERT INTO public.automation_events (event_type, lead_id, payload)
    VALUES (
      'student_no_show',
      v_enrollment.lead_id,
      jsonb_build_object('enrollment_id', p_enrollment_id, 'session_id', v_part.course_session_id)
    );
  ELSE
    INSERT INTO public.lead_activities (
      lead_id, activity_type, actor_type, actor_id, summary, metadata
    ) VALUES (
      v_enrollment.lead_id,
      'attendance_recorded',
      'user',
      v_actor_id,
      'Attendance updated to ' || p_attendance_status || ' for session ' || COALESCE(v_session.code, ''),
      jsonb_build_object('enrollment_id', p_enrollment_id, 'attendance_status', p_attendance_status, 'notes', p_notes)
    );

    INSERT INTO public.automation_events (event_type, lead_id, payload)
    VALUES (
      'attendance_recorded',
      v_enrollment.lead_id,
      jsonb_build_object('enrollment_id', p_enrollment_id, 'attendance_status', p_attendance_status)
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'enrollment_id', p_enrollment_id,
    'attendance_status', p_attendance_status
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 15. RPC: record_course_completion
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_course_completion(
  p_enrollment_id UUID,
  p_completion_status TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_enrollment RECORD;
  v_session RECORD;
  v_part RECORD;
  v_completed_at TIMESTAMPTZ;
  v_eval_result JSONB;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: only active application users can record completion.';
  END IF;
  v_actor_id := auth.uid();

  IF p_completion_status NOT IN ('not_started', 'completed', 'incomplete') THEN
    RAISE EXCEPTION 'Invalid completion status: %. Must be not_started, completed, or incomplete.', p_completion_status;
  END IF;

  SELECT * INTO v_enrollment FROM public.enrollments WHERE id = p_enrollment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Enrollment % not found.', p_enrollment_id;
  END IF;

  SELECT * INTO v_part FROM public.course_participations WHERE enrollment_id = p_enrollment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Course participation not found for enrollment %. Assign to session first.', p_enrollment_id;
  END IF;

  SELECT * INTO v_session FROM public.course_sessions WHERE id = v_part.course_session_id;

  v_completed_at := CASE WHEN p_completion_status = 'completed' THEN now() ELSE NULL END;

  -- Update Participation
  UPDATE public.course_participations
  SET
    completion_status = p_completion_status,
    completed_at = v_completed_at,
    completed_by = CASE WHEN p_completion_status = 'completed' THEN v_actor_id ELSE NULL END,
    notes = COALESCE(p_notes, notes),
    updated_at = now()
  WHERE enrollment_id = p_enrollment_id;

  -- Log Activity & Automation
  IF p_completion_status = 'completed' THEN
    INSERT INTO public.lead_activities (
      lead_id, activity_type, actor_type, actor_id, summary, metadata
    ) VALUES (
      v_enrollment.lead_id,
      'course_completed',
      'user',
      v_actor_id,
      'Completed course ' || v_enrollment.course_name_snapshot || ' in session ' || COALESCE(v_session.code, ''),
      jsonb_build_object('enrollment_id', p_enrollment_id, 'session_id', v_part.course_session_id, 'completed_at', v_completed_at)
    );

    INSERT INTO public.automation_events (event_type, lead_id, payload)
    VALUES (
      'course_completed',
      v_enrollment.lead_id,
      jsonb_build_object('enrollment_id', p_enrollment_id, 'session_id', v_part.course_session_id, 'course_id', v_enrollment.course_id)
    );

    -- Trigger safe idempotent pipeline post-course transition evaluation
    v_eval_result := public.evaluate_lead_post_course_transition(v_enrollment.lead_id);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'enrollment_id', p_enrollment_id,
    'completion_status', p_completion_status,
    'pipeline_evaluation', v_eval_result
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 16. RPC: update_student_checklist_item
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_student_checklist_item(
  p_item_id UUID,
  p_status TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item RECORD;
  v_actor_id UUID;
  v_completed_at TIMESTAMPTZ;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: only active application users can update checklist items.';
  END IF;
  v_actor_id := auth.uid();

  IF p_status NOT IN ('pending', 'completed', 'waived') THEN
    RAISE EXCEPTION 'Invalid checklist status: %. Must be pending, completed, or waived.', p_status;
  END IF;

  SELECT * INTO v_item FROM public.student_checklist_items WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student checklist item % not found.', p_item_id;
  END IF;

  v_completed_at := CASE WHEN p_status IN ('completed', 'waived') THEN now() ELSE NULL END;

  UPDATE public.student_checklist_items
  SET
    status = p_status,
    completed_at = v_completed_at,
    completed_by = CASE WHEN p_status IN ('completed', 'waived') THEN v_actor_id ELSE NULL END,
    notes = COALESCE(p_notes, notes),
    updated_at = now()
  WHERE id = p_item_id;

  RETURN jsonb_build_object(
    'success', true,
    'item_id', p_item_id,
    'status', p_status
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 17. RPC: get_course_operations_dashboard (Optimized Aggregator)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_course_operations_dashboard()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings RECORD;
  v_readiness_days INT;
  v_followup_days INT;
  
  -- KPIs
  v_active_sessions_count INT := 0;
  v_upcoming_sessions_count INT := 0;
  v_active_students_count INT := 0;
  v_unassigned_enrollments_count INT := 0;
  v_needs_attention_count INT := 0;

  v_upcoming_sessions JSONB := '[]'::jsonb;
  v_recently_completed JSONB := '[]'::jsonb;
  v_unassigned_students JSONB := '[]'::jsonb;
  v_needs_attention_list JSONB := '[]'::jsonb;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: only active application users can view course operations.';
  END IF;

  SELECT 
    COALESCE(course_readiness_window_days, 14) AS course_readiness_window_days,
    COALESCE(post_course_followup_due_days, 2) AS post_course_followup_due_days
  INTO v_settings
  FROM public.app_settings
  LIMIT 1;

  v_readiness_days := COALESCE(v_settings.course_readiness_window_days, 14);
  v_followup_days := COALESCE(v_settings.post_course_followup_due_days, 2);

  -- 1. Operational KPIs
  SELECT count(*) INTO v_active_sessions_count
  FROM public.course_sessions
  WHERE status IN ('draft', 'open', 'confirmed');

  SELECT count(*) INTO v_upcoming_sessions_count
  FROM public.course_sessions
  WHERE status IN ('open', 'confirmed') AND start_date >= CURRENT_DATE;

  SELECT count(DISTINCT e.lead_id) INTO v_active_students_count
  FROM public.enrollments e
  JOIN public.course_sessions s ON s.id = e.course_session_id
  WHERE e.enrollment_status = 'confirmed'
    AND s.status IN ('open', 'confirmed');

  SELECT count(*) INTO v_unassigned_enrollments_count
  FROM public.enrollments
  WHERE enrollment_status = 'confirmed' AND course_session_id IS NULL;

  -- 2. Upcoming Sessions List
  SELECT jsonb_agg(sub) INTO v_upcoming_sessions
  FROM (
    SELECT
      s.id,
      s.code,
      s.title,
      s.status,
      s.start_date,
      s.end_date,
      s.timezone,
      s.capacity,
      s.location,
      s.instructor_name,
      c.id AS course_id,
      c.name AS course_name,
      c.code AS course_code,
      COUNT(DISTINCT e.id) FILTER (WHERE e.enrollment_status = 'confirmed') AS confirmed_students_count,
      CASE
        WHEN s.capacity IS NULL THEN NULL
        ELSE GREATEST(s.capacity - COUNT(DISTINCT e.id) FILTER (WHERE e.enrollment_status = 'confirmed'), 0)
      END AS available_seats,
      COUNT(DISTINCT e.id) FILTER (
        WHERE e.enrollment_status = 'confirmed'
          AND EXISTS (
            SELECT 1 FROM public.student_checklist_items ci
            WHERE ci.enrollment_id = e.id AND ci.required = true AND ci.status = 'pending'
          )
      ) AS unready_students_count
    FROM public.course_sessions s
    JOIN public.courses c ON c.id = s.course_id
    LEFT JOIN public.enrollments e ON e.course_session_id = s.id AND e.enrollment_status = 'confirmed'
    WHERE s.status IN ('draft', 'open', 'confirmed')
    GROUP BY s.id, c.id
    ORDER BY s.start_date ASC
    LIMIT 50
  ) sub;

  -- 3. Recently Completed Sessions
  SELECT jsonb_agg(sub) INTO v_recently_completed
  FROM (
    SELECT
      s.id,
      s.code,
      s.title,
      s.status,
      s.start_date,
      s.end_date,
      c.name AS course_name,
      COUNT(DISTINCT e.id) FILTER (WHERE e.enrollment_status = 'confirmed') AS total_students,
      COUNT(DISTINCT p.id) FILTER (WHERE p.attendance_status = 'attended') AS attended_count,
      COUNT(DISTINCT p.id) FILTER (WHERE p.completion_status = 'completed') AS completed_count
    FROM public.course_sessions s
    JOIN public.courses c ON c.id = s.course_id
    LEFT JOIN public.enrollments e ON e.course_session_id = s.id AND e.enrollment_status = 'confirmed'
    LEFT JOIN public.course_participations p ON p.enrollment_id = e.id
    WHERE s.status = 'completed' OR (s.status = 'confirmed' AND s.end_date < CURRENT_DATE)
    GROUP BY s.id, c.id
    ORDER BY s.end_date DESC
    LIMIT 10
  ) sub;

  -- 4. Unassigned Students Awaiting Session
  SELECT jsonb_agg(sub) INTO v_unassigned_students
  FROM (
    SELECT
      e.id AS enrollment_id,
      e.lead_id,
      l.first_name || ' ' || l.last_name AS student_name,
      l.email,
      l.phone,
      e.course_id,
      e.course_name_snapshot,
      e.enrollment_date,
      e.agreed_amount,
      COALESCE(paid_sum.paid_amt, 0.00) AS net_paid,
      GREATEST(e.agreed_amount - COALESCE(paid_sum.paid_amt, 0.00), 0.00) AS outstanding_balance
    FROM public.enrollments e
    JOIN public.leads l ON l.id = e.lead_id
    LEFT JOIN (
      SELECT enrollment_id,
             SUM(CASE WHEN payment_status = 'paid' AND payment_type = 'payment' THEN amount
                      WHEN payment_type = 'refund' OR payment_status = 'refunded' THEN -amount
                      ELSE 0 END) AS paid_amt
      FROM public.enrollment_payments
      GROUP BY enrollment_id
    ) paid_sum ON paid_sum.enrollment_id = e.id
    WHERE e.enrollment_status = 'confirmed' AND e.course_session_id IS NULL
    ORDER BY e.enrollment_date ASC
    LIMIT 50
  ) sub;

  -- 5. Operational Needs Attention Aggregator
  SELECT jsonb_agg(sub) INTO v_needs_attention_list
  FROM (
    -- A) ENROLLMENT_WITHOUT_SESSION
    SELECT
      'ENROLLMENT_WITHOUT_SESSION' AS reason_code,
      'critical' AS severity,
      e.id AS enrollment_id,
      e.lead_id,
      l.first_name || ' ' || l.last_name AS student_name,
      e.course_name_snapshot AS course_name,
      NULL AS session_code,
      NULL AS session_id,
      'Confirmed enrollment has no course session assigned.' AS message,
      e.created_at AS detected_at
    FROM public.enrollments e
    JOIN public.leads l ON l.id = e.lead_id
    WHERE e.enrollment_status = 'confirmed' AND e.course_session_id IS NULL

    UNION ALL

    -- B) SESSION_CANCELLED_REASSIGNMENT_REQUIRED
    SELECT
      'SESSION_CANCELLED_REASSIGNMENT_REQUIRED' AS reason_code,
      'critical' AS severity,
      e.id AS enrollment_id,
      e.lead_id,
      l.first_name || ' ' || l.last_name AS student_name,
      e.course_name_snapshot AS course_name,
      s.code AS session_code,
      s.id AS session_id,
      'Assigned session ' || s.code || ' was cancelled. Student requires reassignment.' AS message,
      s.updated_at AS detected_at
    FROM public.enrollments e
    JOIN public.leads l ON l.id = e.lead_id
    JOIN public.course_sessions s ON s.id = e.course_session_id
    WHERE e.enrollment_status = 'confirmed' AND s.status = 'cancelled'

    UNION ALL

    -- C) UPCOMING_SESSION_UNREADY
    SELECT
      'UPCOMING_SESSION_UNREADY' AS reason_code,
      'warning' AS severity,
      e.id AS enrollment_id,
      e.lead_id,
      l.first_name || ' ' || l.last_name AS student_name,
      e.course_name_snapshot AS course_name,
      s.code AS session_code,
      s.id AS session_id,
      'Session starts in ' || (s.start_date - CURRENT_DATE) || ' days but student has pending required checklist items.' AS message,
      s.start_date::timestamptz AS detected_at
    FROM public.enrollments e
    JOIN public.leads l ON l.id = e.lead_id
    JOIN public.course_sessions s ON s.id = e.course_session_id
    WHERE e.enrollment_status = 'confirmed'
      AND s.status IN ('open', 'confirmed')
      AND s.start_date <= (CURRENT_DATE + v_readiness_days)
      AND s.start_date >= CURRENT_DATE
      AND EXISTS (
        SELECT 1 FROM public.student_checklist_items ci
        WHERE ci.enrollment_id = e.id AND ci.required = true AND ci.status = 'pending'
      )

    UNION ALL

    -- D) PAYMENT_OUTSTANDING for upcoming session (within window)
    SELECT
      'PAYMENT_OUTSTANDING' AS reason_code,
      'warning' AS severity,
      e.id AS enrollment_id,
      e.lead_id,
      l.first_name || ' ' || l.last_name AS student_name,
      e.course_name_snapshot AS course_name,
      s.code AS session_code,
      s.id AS session_id,
      'Student has outstanding balance of $' || (e.agreed_amount - COALESCE(paid_sum.paid_amt, 0.00)) || ' for upcoming session.' AS message,
      s.start_date::timestamptz AS detected_at
    FROM public.enrollments e
    JOIN public.leads l ON l.id = e.lead_id
    JOIN public.course_sessions s ON s.id = e.course_session_id
    LEFT JOIN (
      SELECT enrollment_id,
             SUM(CASE WHEN payment_status = 'paid' AND payment_type = 'payment' THEN amount
                      WHEN payment_type = 'refund' OR payment_status = 'refunded' THEN -amount
                      ELSE 0 END) AS paid_amt
      FROM public.enrollment_payments
      GROUP BY enrollment_id
    ) paid_sum ON paid_sum.enrollment_id = e.id
    WHERE e.enrollment_status = 'confirmed'
      AND s.status IN ('open', 'confirmed')
      AND s.start_date <= (CURRENT_DATE + v_readiness_days)
      AND (e.agreed_amount - COALESCE(paid_sum.paid_amt, 0.00)) > 0

    UNION ALL

    -- E) NO_SHOW
    SELECT
      'NO_SHOW' AS reason_code,
      'warning' AS severity,
      e.id AS enrollment_id,
      e.lead_id,
      l.first_name || ' ' || l.last_name AS student_name,
      e.course_name_snapshot AS course_name,
      s.code AS session_code,
      s.id AS session_id,
      'Student marked as NO SHOW. Reschedule or follow-up required.' AS message,
      p.updated_at AS detected_at
    FROM public.course_participations p
    JOIN public.enrollments e ON e.id = p.enrollment_id
    JOIN public.leads l ON l.id = e.lead_id
    JOIN public.course_sessions s ON s.id = p.course_session_id
    WHERE p.attendance_status = 'no_show'

    UNION ALL

    -- F) POST_COURSE_FOLLOWUP_DUE
    SELECT
      'POST_COURSE_FOLLOWUP_DUE' AS reason_code,
      'info' AS severity,
      e.id AS enrollment_id,
      e.lead_id,
      l.first_name || ' ' || l.last_name AS student_name,
      e.course_name_snapshot AS course_name,
      s.code AS session_code,
      s.id AS session_id,
      'Course completed ' || ROUND(EXTRACT(EPOCH FROM (now() - p.completed_at)) / 86400)::int || ' days ago. Post-course review due.' AS message,
      p.completed_at AS detected_at
    FROM public.course_participations p
    JOIN public.enrollments e ON e.id = p.enrollment_id
    JOIN public.leads l ON l.id = e.lead_id
    JOIN public.course_sessions s ON s.id = p.course_session_id
    WHERE p.completion_status = 'completed'
      AND p.completed_at IS NOT NULL
      AND p.completed_at + (v_followup_days || ' days')::interval < now()
      AND NOT EXISTS (
        SELECT 1 FROM public.tasks t
        WHERE t.lead_id = l.id AND t.title ILIKE '%follow-up%' AND t.status = 'completed'
      )
  ) sub;

  v_needs_attention_count := jsonb_array_length(COALESCE(v_needs_attention_list, '[]'::jsonb));

  RETURN jsonb_build_object(
    'kpis', jsonb_build_object(
      'active_sessions_count', v_active_sessions_count,
      'upcoming_sessions_count', v_upcoming_sessions_count,
      'active_students_count', v_active_students_count,
      'unassigned_enrollments_count', v_unassigned_enrollments_count,
      'needs_attention_count', v_needs_attention_count
    ),
    'upcoming_sessions', COALESCE(v_upcoming_sessions, '[]'::jsonb),
    'recently_completed', COALESCE(v_recently_completed, '[]'::jsonb),
    'unassigned_students', COALESCE(v_unassigned_students, '[]'::jsonb),
    'needs_attention', COALESCE(v_needs_attention_list, '[]'::jsonb),
    'settings', jsonb_build_object(
      'readiness_window_days', v_readiness_days,
      'followup_due_days', v_followup_days
    )
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 18. RPC: get_course_session_detail (Optimized Roster Aggregator)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_course_session_detail(p_session_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session RECORD;
  v_course RECORD;
  v_roster JSONB := '[]'::jsonb;
  v_confirmed_count INT := 0;
  v_available_seats INT := NULL;
  v_settings RECORD;
  v_readiness_days INT := 14;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: only active application users can view session details.';
  END IF;

  SELECT 
    COALESCE(course_readiness_window_days, 14) AS course_readiness_window_days
  INTO v_settings
  FROM public.app_settings
  LIMIT 1;

  v_readiness_days := COALESCE(v_settings.course_readiness_window_days, 14);

  SELECT * INTO v_session FROM public.course_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session % not found.', p_session_id;
  END IF;

  SELECT * INTO v_course FROM public.courses WHERE id = v_session.course_id;

  SELECT COUNT(*) INTO v_confirmed_count
  FROM public.enrollments
  WHERE course_session_id = p_session_id AND enrollment_status = 'confirmed';

  IF v_session.capacity IS NOT NULL THEN
    v_available_seats := GREATEST(v_session.capacity - v_confirmed_count, 0);
  END IF;

  -- Build Complete Roster with Financial & Checklist Data (Single Query)
  SELECT jsonb_agg(sub) INTO v_roster
  FROM (
    SELECT
      e.id AS enrollment_id,
      e.lead_id,
      l.first_name || ' ' || l.last_name AS student_name,
      l.email AS student_email,
      l.phone AS student_phone,
      e.enrollment_status,
      e.enrollment_date,
      e.agreed_amount,
      e.currency,
      COALESCE(paid_sum.paid_amt, 0.00) AS net_paid,
      GREATEST(e.agreed_amount - COALESCE(paid_sum.paid_amt, 0.00), 0.00) AS outstanding_balance,
      CASE
        WHEN GREATEST(e.agreed_amount - COALESCE(paid_sum.paid_amt, 0.00), 0.00) = 0 THEN 'paid'
        WHEN COALESCE(paid_sum.paid_amt, 0.00) > 0 THEN 'partial'
        ELSE 'unpaid'
      END AS payment_status_derived,
      COALESCE(p.attendance_status, 'expected') AS attendance_status,
      COALESCE(p.completion_status, 'not_started') AS completion_status,
      p.completed_at,
      p.notes AS participation_notes,
      -- Repeat Student Flag: Lead has 2 or more confirmed enrollments
      (SELECT COUNT(*) >= 2 FROM public.enrollments e2 WHERE e2.lead_id = e.lead_id AND e2.enrollment_status = 'confirmed') AS repeat_student,
      -- Checklist Stats
      COALESCE(chk_stats.total_items, 0) AS checklist_total,
      COALESCE(chk_stats.completed_items, 0) AS checklist_completed,
      COALESCE(chk_stats.pending_items, 0) AS checklist_pending,
      COALESCE(chk_stats.required_pending, 0) AS checklist_required_pending,
      -- Checklist Items Array
      COALESCE(chk_items.items, '[]'::jsonb) AS checklist_items,
      -- Needs Attention Reasons Array
      ARRAY_REMOVE(ARRAY[
        CASE WHEN v_session.status = 'cancelled' THEN 'SESSION_CANCELLED_REASSIGNMENT_REQUIRED' ELSE NULL END,
        CASE WHEN GREATEST(e.agreed_amount - COALESCE(paid_sum.paid_amt, 0.00), 0.00) > 0 THEN 'PAYMENT_OUTSTANDING' ELSE NULL END,
        CASE WHEN COALESCE(chk_stats.required_pending, 0) > 0 THEN 'MISSING_REQUIRED_ITEM' ELSE NULL END,
        CASE WHEN v_session.start_date <= (CURRENT_DATE + v_readiness_days) AND COALESCE(chk_stats.required_pending, 0) > 0 THEN 'UPCOMING_SESSION_UNREADY' ELSE NULL END,
        CASE WHEN p.attendance_status = 'no_show' THEN 'NO_SHOW' ELSE NULL END
      ], NULL) AS needs_attention_reasons
    FROM public.enrollments e
    JOIN public.leads l ON l.id = e.lead_id
    LEFT JOIN public.course_participations p ON p.enrollment_id = e.id
    LEFT JOIN (
      SELECT enrollment_id,
             SUM(CASE WHEN payment_status = 'paid' AND payment_type = 'payment' THEN amount
                      WHEN payment_type = 'refund' OR payment_status = 'refunded' THEN -amount
                      ELSE 0 END) AS paid_amt
      FROM public.enrollment_payments
      GROUP BY enrollment_id
    ) paid_sum ON paid_sum.enrollment_id = e.id
    LEFT JOIN (
      SELECT
        enrollment_id,
        count(*) AS total_items,
        count(*) FILTER (WHERE status = 'completed' OR status = 'waived') AS completed_items,
        count(*) FILTER (WHERE status = 'pending') AS pending_items,
        count(*) FILTER (WHERE required = true AND status = 'pending') AS required_pending
      FROM public.student_checklist_items
      GROUP BY enrollment_id
    ) chk_stats ON chk_stats.enrollment_id = e.id
    LEFT JOIN (
      SELECT
        enrollment_id,
        jsonb_agg(jsonb_build_object(
          'id', id,
          'template_id', template_id,
          'title_snapshot', title_snapshot,
          'required', required,
          'status', status,
          'completed_at', completed_at,
          'completed_by', completed_by,
          'notes', notes
        ) ORDER BY created_at ASC) AS items
      FROM public.student_checklist_items
      GROUP BY enrollment_id
    ) chk_items ON chk_items.enrollment_id = e.id
    WHERE e.course_session_id = p_session_id
    ORDER BY l.first_name ASC, l.last_name ASC
  ) sub;

  RETURN jsonb_build_object(
    'session', jsonb_build_object(
      'id', v_session.id,
      'code', v_session.code,
      'title', v_session.title,
      'status', v_session.status,
      'start_date', v_session.start_date,
      'end_date', v_session.end_date,
      'timezone', v_session.timezone,
      'capacity', v_session.capacity,
      'location', v_session.location,
      'instructor_name', v_session.instructor_name,
      'notes', v_session.notes,
      'confirmed_students_count', v_confirmed_count,
      'available_seats', v_available_seats,
      'is_at_capacity', (v_session.capacity IS NOT NULL AND v_confirmed_count >= v_session.capacity),
      'is_over_capacity', (v_session.capacity IS NOT NULL AND v_confirmed_count > v_session.capacity)
    ),
    'course', jsonb_build_object(
      'id', v_course.id,
      'code', v_course.code,
      'name', v_course.name,
      'currency', v_course.currency
    ),
    'roster', COALESCE(v_roster, '[]'::jsonb)
  );
END;
$$;
