-- =============================================================================
-- Migration 00037: Create Alumni & Post-Course Experience (Phase 4 Block 5)
-- =============================================================================
-- Implements:
-- 1. app_settings extensions (post_course_feedback_due_days, testimonial_request_due_days)
-- 2. Constraints updates:
--    - lead_activities_activity_type_check (post-course activities)
--    - lead_stage_history_change_reason_check ('alumni_transition')
--    - automations_trigger_type_check & automation_events_event_type_check
-- 3. Forms table purpose extension & form_submissions engagement linkage
-- 4. post_course_engagements table (1:1 per completed enrollment)
-- 5. lead_course_interests table (normalized future course interest audit trail)
-- 6. post_course_feedback_tokens table (secure unguessable feedback links)
-- 7. Performance indexes
-- 8. Row Level Security (RLS) policies
-- 9. Transactional & Aggregator RPC functions:
--    - record_course_completion (extended to initialize engagement idempotently)
--    - complete_post_course_followup
--    - update_post_course_engagement
--    - create_post_course_feedback_token
--    - submit_post_course_feedback_public
--    - record_post_course_testimonial
--    - record_future_course_interest
--    - move_lead_to_alumni
--    - get_post_course_dashboard
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. App Settings Extensions
-- -----------------------------------------------------------------------------
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS post_course_feedback_due_days INT NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS testimonial_request_due_days INT NOT NULL DEFAULT 5;

-- -----------------------------------------------------------------------------
-- 2. Constraints Updates
-- -----------------------------------------------------------------------------
-- Lead Stage History change reason
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
    'post_course_transition',
    'alumni_transition'
  ));

-- Lead Activities activity type
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
    'student_no_show'::text, 'checklist_item_updated'::text,
    -- Block 5 Post-Course Activities:
    'post_course_followup_created'::text,
    'post_course_followup_completed'::text,
    'feedback_requested'::text,
    'feedback_received'::text,
    'testimonial_requested'::text,
    'testimonial_received'::text,
    'future_course_interest_added'::text
  ]));

-- Automations triggers
ALTER TABLE public.automations
  DROP CONSTRAINT IF EXISTS automations_trigger_type_check;

ALTER TABLE public.automations
  ADD CONSTRAINT automations_trigger_type_check
  CHECK (trigger_type IN (
    'form_submitted', 'lead_created', 'qualification_status_changed',
    'pipeline_stage_changed', 'tag_added', 'manual_enrollment',
    'course_session_assigned', 'course_session_changed',
    'attendance_recorded', 'course_completed', 'student_no_show',
    -- Block 5 triggers:
    'post_course_engagement_created',
    'post_course_followup_due',
    'post_course_followup_completed',
    'feedback_received',
    'testimonial_received',
    'future_course_interest_added'
  ));

-- Automation Events event type
ALTER TABLE public.automation_events
  DROP CONSTRAINT IF EXISTS automation_events_event_type_check;

ALTER TABLE public.automation_events
  ADD CONSTRAINT automation_events_event_type_check
  CHECK (event_type IN (
    'form_submitted', 'lead_created', 'qualification_status_changed',
    'pipeline_stage_changed', 'tag_added', 'manual_enrollment',
    'course_session_assigned', 'course_session_changed',
    'attendance_recorded', 'course_completed', 'student_no_show',
    -- Block 5 events:
    'post_course_engagement_created',
    'post_course_followup_due',
    'post_course_followup_completed',
    'feedback_received',
    'testimonial_received',
    'future_course_interest_added'
  ));

-- -----------------------------------------------------------------------------
-- 3. Forms Table Purpose & Form Submissions Engagement Linkage
-- -----------------------------------------------------------------------------
ALTER TABLE public.forms
  ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'lead_capture';

ALTER TABLE public.forms
  DROP CONSTRAINT IF EXISTS forms_purpose_check;

ALTER TABLE public.forms
  ADD CONSTRAINT forms_purpose_check
  CHECK (purpose IN ('general', 'lead_capture', 'course_feedback'));

-- -----------------------------------------------------------------------------
-- 4. Post-Course Engagements Table (1:1 per completed enrollment)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.post_course_engagements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID NOT NULL UNIQUE REFERENCES public.enrollments(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  followup_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (followup_status IN ('pending', 'in_progress', 'completed', 'skipped')),
  feedback_status TEXT NOT NULL DEFAULT 'not_requested'
    CHECK (feedback_status IN ('not_requested', 'requested', 'received', 'declined')),
  testimonial_status TEXT NOT NULL DEFAULT 'not_requested'
    CHECK (testimonial_status IN ('not_requested', 'requested', 'received', 'declined')),
  testimonial_consent_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (testimonial_consent_status IN ('unknown', 'granted', 'declined')),
  followup_due_at TIMESTAMPTZ NOT NULL,
  followup_completed_at TIMESTAMPTZ NULL,
  feedback_requested_at TIMESTAMPTZ NULL,
  feedback_received_at TIMESTAMPTZ NULL,
  feedback_notes TEXT NULL,
  testimonial_requested_at TIMESTAMPTZ NULL,
  testimonial_received_at TIMESTAMPTZ NULL,
  testimonial_notes TEXT NULL,
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.post_course_engagements IS
  'Tracks post-course follow-up, feedback, testimonial, and student satisfaction strictly per completed enrollment.';

-- Link form_submissions to post_course_engagements
ALTER TABLE public.form_submissions
  ADD COLUMN IF NOT EXISTS post_course_engagement_id UUID NULL REFERENCES public.post_course_engagements(id) ON DELETE SET NULL;

-- -----------------------------------------------------------------------------
-- 5. Normalized Future Course Interests Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lead_course_interests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE RESTRICT,
  source TEXT NOT NULL CHECK (source IN ('manual', 'post_course', 'form')),
  source_enrollment_id UUID NULL REFERENCES public.enrollments(id) ON DELETE SET NULL,
  post_course_engagement_id UUID NULL REFERENCES public.post_course_engagements(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'converted', 'dismissed')),
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.lead_course_interests IS
  'Auditable, normalized store of student interest in future courses, preserving source enrollment context.';

-- -----------------------------------------------------------------------------
-- 6. Secure Feedback Tokens Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.post_course_feedback_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id UUID NOT NULL REFERENCES public.post_course_engagements(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  token_hint TEXT NULL,
  expires_at TIMESTAMPTZ NULL,
  used_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.post_course_feedback_tokens IS
  'Secure, single-use SHA-256 hashed tokens for public post-course feedback submission links.';

-- -----------------------------------------------------------------------------
-- 7. Performance Indexes
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_post_course_engagements_lead ON public.post_course_engagements(lead_id);
CREATE INDEX IF NOT EXISTS idx_post_course_engagements_enrollment ON public.post_course_engagements(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_post_course_engagements_followup ON public.post_course_engagements(followup_status, followup_due_at);
CREATE INDEX IF NOT EXISTS idx_post_course_engagements_feedback ON public.post_course_engagements(feedback_status);
CREATE INDEX IF NOT EXISTS idx_post_course_engagements_testimonial ON public.post_course_engagements(testimonial_status);
CREATE INDEX IF NOT EXISTS idx_lead_course_interests_lead_status ON public.lead_course_interests(lead_id, status);
CREATE INDEX IF NOT EXISTS idx_lead_course_interests_course_status ON public.lead_course_interests(course_id, status);
CREATE INDEX IF NOT EXISTS idx_feedback_tokens_hash ON public.post_course_feedback_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_feedback_tokens_engagement ON public.post_course_feedback_tokens(engagement_id);
CREATE INDEX IF NOT EXISTS idx_form_submissions_engagement ON public.form_submissions(post_course_engagement_id);

-- -----------------------------------------------------------------------------
-- 8. Row Level Security (RLS)
-- -----------------------------------------------------------------------------
ALTER TABLE public.post_course_engagements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_course_interests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_course_feedback_tokens ENABLE ROW LEVEL SECURITY;

-- post_course_engagements: authenticated active app users only
DROP POLICY IF EXISTS "post_course_engagements_select_active" ON public.post_course_engagements;
CREATE POLICY "post_course_engagements_select_active" ON public.post_course_engagements
  FOR SELECT TO authenticated USING (public.is_active_app_user());

DROP POLICY IF EXISTS "post_course_engagements_all_active" ON public.post_course_engagements;
CREATE POLICY "post_course_engagements_all_active" ON public.post_course_engagements
  FOR ALL TO authenticated USING (public.is_active_app_user());

-- lead_course_interests: authenticated active app users only
DROP POLICY IF EXISTS "lead_course_interests_select_active" ON public.lead_course_interests;
CREATE POLICY "lead_course_interests_select_active" ON public.lead_course_interests
  FOR SELECT TO authenticated USING (public.is_active_app_user());

DROP POLICY IF EXISTS "lead_course_interests_all_active" ON public.lead_course_interests;
CREATE POLICY "lead_course_interests_all_active" ON public.lead_course_interests
  FOR ALL TO authenticated USING (public.is_active_app_user());

-- post_course_feedback_tokens: authenticated active app users only (public accesses via security definer RPC)
DROP POLICY IF EXISTS "feedback_tokens_select_active" ON public.post_course_feedback_tokens;
CREATE POLICY "feedback_tokens_select_active" ON public.post_course_feedback_tokens
  FOR SELECT TO authenticated USING (public.is_active_app_user());

DROP POLICY IF EXISTS "feedback_tokens_all_active" ON public.post_course_feedback_tokens;
CREATE POLICY "feedback_tokens_all_active" ON public.post_course_feedback_tokens
  FOR ALL TO authenticated USING (public.is_active_app_user());

-- -----------------------------------------------------------------------------
-- 9. Transactional RPCs
-- -----------------------------------------------------------------------------

-- 9.1 Extend record_course_completion to initialize engagement idempotently
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
  v_enrollment RECORD;
  v_session RECORD;
  v_part RECORD;
  v_actor_id UUID;
  v_completed_at TIMESTAMPTZ;
  v_eval_result JSONB := NULL;
  v_followup_days INT;
  v_followup_due_at TIMESTAMPTZ;
  v_engagement_id UUID;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: only active application users can record course completion.';
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
    RAISE EXCEPTION 'Course participation record not found for enrollment %.', p_enrollment_id;
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

  -- Log Activity & Automation & Initialize Engagement
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

    -- Safe Post-Course Pipeline Stage Move Evaluator (Block 4)
    v_eval_result := public.evaluate_lead_post_course_transition(v_enrollment.lead_id);

    -- Initialize Post-Course Engagement (Block 5)
    SELECT COALESCE(post_course_followup_due_days, 2) INTO v_followup_days
    FROM public.app_settings LIMIT 1;
    v_followup_days := COALESCE(v_followup_days, 2);

    v_followup_due_at := v_completed_at + (v_followup_days || ' days')::interval;

    INSERT INTO public.post_course_engagements (
      enrollment_id,
      lead_id,
      followup_status,
      feedback_status,
      testimonial_status,
      testimonial_consent_status,
      followup_due_at
    ) VALUES (
      p_enrollment_id,
      v_enrollment.lead_id,
      'pending',
      'not_requested',
      'not_requested',
      'unknown',
      v_followup_due_at
    )
    ON CONFLICT (enrollment_id) DO UPDATE
      SET followup_due_at = EXCLUDED.followup_due_at,
          updated_at = now()
    RETURNING id INTO v_engagement_id;

    -- Log Activity for Engagement Creation
    INSERT INTO public.lead_activities (
      lead_id, activity_type, actor_type, actor_id, summary, metadata
    ) VALUES (
      v_enrollment.lead_id,
      'post_course_followup_created',
      'system',
      v_actor_id,
      'Post-course engagement created for ' || v_enrollment.course_name_snapshot || '. Follow-up due ' || to_char(v_followup_due_at, 'YYYY-MM-DD'),
      jsonb_build_object('engagement_id', v_engagement_id, 'enrollment_id', p_enrollment_id, 'followup_due_at', v_followup_due_at)
    );

    -- Emit Canonical Event for Engagement Created (do NOT emit due event before due_at)
    INSERT INTO public.automation_events (event_type, lead_id, payload)
    VALUES (
      'post_course_engagement_created',
      v_enrollment.lead_id,
      jsonb_build_object('engagement_id', v_engagement_id, 'enrollment_id', p_enrollment_id, 'followup_due_at', v_followup_due_at)
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'enrollment_id', p_enrollment_id,
    'completion_status', p_completion_status,
    'pipeline_evaluation', v_eval_result
  );
END;
$$;


-- 9.2 Complete Post-Course Follow-Up (Explicit Action & Idempotent)
CREATE OR REPLACE FUNCTION public.complete_post_course_followup(
  p_engagement_id UUID,
  p_notes TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_eng RECORD;
  v_enr RECORD;
  v_actor_id UUID;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: only active application users can complete follow-ups.';
  END IF;
  v_actor_id := auth.uid();

  SELECT * INTO v_eng FROM public.post_course_engagements WHERE id = p_engagement_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Post-course engagement % not found.', p_engagement_id;
  END IF;

  SELECT * INTO v_enr FROM public.enrollments WHERE id = v_eng.enrollment_id;

  -- Idempotency: if already completed, return existing without duplicating activity/event
  IF v_eng.followup_status = 'completed' THEN
    RETURN jsonb_build_object(
      'success', true,
      'engagement_id', p_engagement_id,
      'followup_status', 'completed',
      'already_completed', true
    );
  END IF;

  UPDATE public.post_course_engagements
  SET
    followup_status = 'completed',
    followup_completed_at = now(),
    notes = COALESCE(p_notes, notes),
    updated_at = now()
  WHERE id = p_engagement_id;

  -- Log Activity
  INSERT INTO public.lead_activities (
    lead_id, activity_type, actor_type, actor_id, summary, metadata
  ) VALUES (
    v_eng.lead_id,
    'post_course_followup_completed',
    'user',
    v_actor_id,
    'Completed post-course follow-up for ' || v_enr.course_name_snapshot,
    jsonb_build_object('engagement_id', p_engagement_id, 'enrollment_id', v_eng.enrollment_id, 'notes', p_notes, 'idempotency_key', p_idempotency_key)
  );

  -- Emit Event
  INSERT INTO public.automation_events (event_type, lead_id, payload)
  VALUES (
    'post_course_followup_completed',
    v_eng.lead_id,
    jsonb_build_object('engagement_id', p_engagement_id, 'enrollment_id', v_eng.enrollment_id, 'idempotency_key', p_idempotency_key)
  );

  RETURN jsonb_build_object(
    'success', true,
    'engagement_id', p_engagement_id,
    'followup_status', 'completed',
    'already_completed', false
  );
END;
$$;


-- 9.3 Update Post-Course Engagement (General)
CREATE OR REPLACE FUNCTION public.update_post_course_engagement(
  p_engagement_id UUID,
  p_followup_status TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: only active application users can update post-course engagements.';
  END IF;

  IF p_followup_status NOT IN ('pending', 'in_progress', 'completed', 'skipped') THEN
    RAISE EXCEPTION 'Invalid followup status: %. Must be pending, in_progress, completed, or skipped.', p_followup_status;
  END IF;

  IF p_followup_status = 'completed' THEN
    RETURN public.complete_post_course_followup(p_engagement_id, p_notes, NULL);
  END IF;

  UPDATE public.post_course_engagements
  SET
    followup_status = p_followup_status,
    notes = COALESCE(p_notes, notes),
    updated_at = now()
  WHERE id = p_engagement_id;

  RETURN jsonb_build_object(
    'success', true,
    'engagement_id', p_engagement_id,
    'followup_status', p_followup_status
  );
END;
$$;


-- 9.4 Create Post-Course Feedback Token (Secure, Unguessable)
CREATE OR REPLACE FUNCTION public.create_post_course_feedback_token(
  p_engagement_id UUID,
  p_expires_in_days INT DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_raw_token TEXT;
  v_token_hash TEXT;
  v_token_hint TEXT;
  v_expires_at TIMESTAMPTZ;
  v_eng RECORD;
  v_enr RECORD;
  v_actor_id UUID;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: only active application users can generate feedback tokens.';
  END IF;
  v_actor_id := auth.uid();

  SELECT * INTO v_eng FROM public.post_course_engagements WHERE id = p_engagement_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Engagement % not found.', p_engagement_id;
  END IF;

  SELECT * INTO v_enr FROM public.enrollments WHERE id = v_eng.enrollment_id;

  -- 256-bit unguessable random hex token
  v_raw_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_token_hash := encode(sha256(convert_to(v_raw_token, 'UTF8')), 'hex');
  v_token_hint := substr(v_raw_token, 1, 6) || '...';
  v_expires_at := now() + (COALESCE(p_expires_in_days, 30) || ' days')::interval;

  INSERT INTO public.post_course_feedback_tokens (
    engagement_id,
    token_hash,
    token_hint,
    expires_at
  ) VALUES (
    p_engagement_id,
    v_token_hash,
    v_token_hint,
    v_expires_at
  );

  -- Mark engagement feedback_status = 'requested'
  UPDATE public.post_course_engagements
  SET
    feedback_status = CASE WHEN feedback_status = 'not_requested' THEN 'requested' ELSE feedback_status END,
    feedback_requested_at = COALESCE(feedback_requested_at, now()),
    updated_at = now()
  WHERE id = p_engagement_id;

  -- Log Activity
  INSERT INTO public.lead_activities (
    lead_id, activity_type, actor_type, actor_id, summary, metadata
  ) VALUES (
    v_eng.lead_id,
    'feedback_requested',
    'user',
    v_actor_id,
    'Generated feedback invitation link for ' || v_enr.course_name_snapshot,
    jsonb_build_object('engagement_id', p_engagement_id, 'expires_at', v_expires_at)
  );

  RETURN jsonb_build_object(
    'success', true,
    'raw_token', v_raw_token,
    'expires_at', v_expires_at
  );
END;
$$;


-- 9.5 Submit Post-Course Feedback Publicly (Secure, Token-Validated)
CREATE OR REPLACE FUNCTION public.submit_post_course_feedback_public(
  p_raw_token TEXT,
  p_comments TEXT DEFAULT NULL,
  p_form_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token_hash TEXT;
  v_tok RECORD;
  v_eng RECORD;
  v_enr RECORD;
  v_submission_id UUID := NULL;
BEGIN
  IF p_raw_token IS NULL OR trim(p_raw_token) = '' THEN
    RAISE EXCEPTION 'Invalid token.';
  END IF;

  v_token_hash := encode(sha256(convert_to(trim(p_raw_token), 'UTF8')), 'hex');

  SELECT * INTO v_tok FROM public.post_course_feedback_tokens WHERE token_hash = v_token_hash;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or unknown feedback token.';
  END IF;

  IF v_tok.expires_at IS NOT NULL AND v_tok.expires_at < now() THEN
    RAISE EXCEPTION 'Feedback token has expired.';
  END IF;

  SELECT * INTO v_eng FROM public.post_course_engagements WHERE id = v_tok.engagement_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Engagement not found.';
  END IF;

  SELECT * INTO v_enr FROM public.enrollments WHERE id = v_eng.enrollment_id;

  -- Idempotency check: if token was already used, return success without duplicate logs
  IF v_tok.used_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'Feedback already submitted.',
      'already_processed', true
    );
  END IF;

  -- Mark token used
  UPDATE public.post_course_feedback_tokens
  SET used_at = now()
  WHERE id = v_tok.id;

  -- Update Engagement
  UPDATE public.post_course_engagements
  SET
    feedback_status = 'received',
    feedback_received_at = now(),
    feedback_notes = COALESCE(p_comments, feedback_notes),
    updated_at = now()
  WHERE id = v_eng.id;

  -- Optional: Link to form_submissions if form_id provided
  IF p_form_id IS NOT NULL THEN
    INSERT INTO public.form_submissions (
      form_id,
      lead_id,
      post_course_engagement_id,
      submitted_data,
      idempotency_key,
      processing_status,
      processed_at
    ) VALUES (
      p_form_id,
      v_eng.lead_id,
      v_eng.id,
      jsonb_build_object('comments', p_comments),
      v_token_hash,
      'processed',
      now()
    ) RETURNING id INTO v_submission_id;
  END IF;

  -- Log Activity
  INSERT INTO public.lead_activities (
    lead_id, activity_type, actor_type, actor_id, summary, metadata
  ) VALUES (
    v_eng.lead_id,
    'feedback_received',
    'system',
    NULL,
    'Student submitted feedback for ' || v_enr.course_name_snapshot,
    jsonb_build_object('engagement_id', v_eng.id, 'enrollment_id', v_eng.enrollment_id, 'comments', p_comments)
  );

  -- Emit Event
  INSERT INTO public.automation_events (event_type, lead_id, payload)
  VALUES (
    'feedback_received',
    v_eng.lead_id,
    jsonb_build_object('engagement_id', v_eng.id, 'enrollment_id', v_eng.enrollment_id)
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Thank you! Your feedback has been recorded.',
    'already_processed', false
  );
END;
$$;


-- 9.6 Record Post-Course Testimonial & Consent
CREATE OR REPLACE FUNCTION public.record_post_course_testimonial(
  p_engagement_id UUID,
  p_status TEXT,
  p_notes TEXT DEFAULT NULL,
  p_consent_status TEXT DEFAULT 'unknown'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_eng RECORD;
  v_enr RECORD;
  v_actor_id UUID;
  v_is_received BOOLEAN := false;
  v_is_requested BOOLEAN := false;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: only active application users can record testimonials.';
  END IF;
  v_actor_id := auth.uid();

  IF p_status NOT IN ('not_requested', 'requested', 'received', 'declined') THEN
    RAISE EXCEPTION 'Invalid testimonial status: %. Must be not_requested, requested, received, or declined.', p_status;
  END IF;

  IF p_consent_status NOT IN ('unknown', 'granted', 'declined') THEN
    RAISE EXCEPTION 'Invalid consent status: %. Must be unknown, granted, or declined.', p_consent_status;
  END IF;

  SELECT * INTO v_eng FROM public.post_course_engagements WHERE id = p_engagement_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Post-course engagement % not found.', p_engagement_id;
  END IF;

  SELECT * INTO v_enr FROM public.enrollments WHERE id = v_eng.enrollment_id;

  v_is_received := (p_status = 'received' AND v_eng.testimonial_status <> 'received');
  v_is_requested := (p_status = 'requested' AND v_eng.testimonial_status = 'not_requested');

  UPDATE public.post_course_engagements
  SET
    testimonial_status = p_status,
    testimonial_consent_status = p_consent_status,
    testimonial_requested_at = CASE WHEN p_status = 'requested' THEN COALESCE(testimonial_requested_at, now()) ELSE testimonial_requested_at END,
    testimonial_received_at = CASE WHEN p_status = 'received' THEN COALESCE(testimonial_received_at, now()) ELSE testimonial_received_at END,
    testimonial_notes = COALESCE(p_notes, testimonial_notes),
    updated_at = now()
  WHERE id = p_engagement_id;

  IF v_is_requested THEN
    INSERT INTO public.lead_activities (
      lead_id, activity_type, actor_type, actor_id, summary, metadata
    ) VALUES (
      v_eng.lead_id,
      'testimonial_requested',
      'user',
      v_actor_id,
      'Requested testimonial for ' || v_enr.course_name_snapshot,
      jsonb_build_object('engagement_id', p_engagement_id, 'enrollment_id', v_eng.enrollment_id)
    );
  END IF;

  IF v_is_received THEN
    INSERT INTO public.lead_activities (
      lead_id, activity_type, actor_type, actor_id, summary, metadata
    ) VALUES (
      v_eng.lead_id,
      'testimonial_received',
      'user',
      v_actor_id,
      'Received testimonial for ' || v_enr.course_name_snapshot || ' (Consent: ' || p_consent_status || ')',
      jsonb_build_object('engagement_id', p_engagement_id, 'enrollment_id', v_eng.enrollment_id, 'consent_status', p_consent_status, 'notes', p_notes)
    );

    INSERT INTO public.automation_events (event_type, lead_id, payload)
    VALUES (
      'testimonial_received',
      v_eng.lead_id,
      jsonb_build_object('engagement_id', p_engagement_id, 'enrollment_id', v_eng.enrollment_id, 'consent_status', p_consent_status)
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'engagement_id', p_engagement_id,
    'testimonial_status', p_status,
    'testimonial_consent_status', p_consent_status
  );
END;
$$;


-- 9.7 Record Normalized Future Course Interest
CREATE OR REPLACE FUNCTION public.record_future_course_interest(
  p_lead_id UUID,
  p_course_id UUID,
  p_source TEXT DEFAULT 'post_course',
  p_source_enrollment_id UUID DEFAULT NULL,
  p_engagement_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead RECORD;
  v_course RECORD;
  v_actor_id UUID;
  v_interest_id UUID;
  v_task_id UUID;
  v_legacy_interests JSONB;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: only active application users can record future course interests.';
  END IF;
  v_actor_id := auth.uid();

  IF p_source NOT IN ('manual', 'post_course', 'form') THEN
    RAISE EXCEPTION 'Invalid source: %. Must be manual, post_course, or form.', p_source;
  END IF;

  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead % not found.', p_lead_id;
  END IF;

  SELECT * INTO v_course FROM public.courses WHERE id = p_course_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Course % not found.', p_course_id;
  END IF;

  -- 1. Insert into normalized lead_course_interests
  INSERT INTO public.lead_course_interests (
    lead_id,
    course_id,
    source,
    source_enrollment_id,
    post_course_engagement_id,
    status,
    notes
  ) VALUES (
    p_lead_id,
    p_course_id,
    p_source,
    p_source_enrollment_id,
    p_engagement_id,
    'active',
    p_notes
  ) RETURNING id INTO v_interest_id;

  -- 2. Backward compatibility: update legacy fields without destroying past entries
  v_legacy_interests := COALESCE(v_lead.course_interests, '[]'::jsonb);
  v_legacy_interests := v_legacy_interests || jsonb_build_array(jsonb_build_object(
    'course_id', p_course_id,
    'course_name', v_course.name,
    'source', p_source,
    'expressed_at', now(),
    'notes', p_notes
  ));

  UPDATE public.leads
  SET
    course_interest = v_course.name,
    course_interests = v_legacy_interests,
    updated_at = now()
  WHERE id = p_lead_id;

  -- 3. Commercial Task Creation (Handoff)
  INSERT INTO public.tasks (
    lead_id,
    task_type,
    title,
    description,
    status,
    due_at,
    created_by
  ) VALUES (
    p_lead_id,
    'call',
    'Next Course Outreach: ' || v_course.name,
    'Student expressed interest in ' || v_course.name || '. Notes: ' || COALESCE(p_notes, 'None'),
    'pending',
    now() + interval '1 day',
    'system'
  ) RETURNING id INTO v_task_id;

  -- 4. Log Activity
  INSERT INTO public.lead_activities (
    lead_id, activity_type, actor_type, actor_id, summary, metadata
  ) VALUES (
    p_lead_id,
    'future_course_interest_added',
    'user',
    v_actor_id,
    'Expressed interest in ' || v_course.name || ' (Source: ' || p_source || ')',
    jsonb_build_object('course_id', p_course_id, 'course_name', v_course.name, 'interest_id', v_interest_id, 'task_id', v_task_id)
  );

  -- 5. Emit Automation Event
  INSERT INTO public.automation_events (event_type, lead_id, payload)
  VALUES (
    'future_course_interest_added',
    p_lead_id,
    jsonb_build_object('course_id', p_course_id, 'course_name', v_course.name, 'interest_id', v_interest_id)
  );

  RETURN jsonb_build_object(
    'success', true,
    'interest_id', v_interest_id,
    'lead_id', p_lead_id,
    'course_id', p_course_id,
    'task_id', v_task_id
  );
END;
$$;


-- 9.8 Move Lead to Alumni (Manual Action with Safety Checks)
CREATE OR REPLACE FUNCTION public.move_lead_to_alumni(
  p_lead_id UUID,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead RECORD;
  v_alumni_stage_id UUID;
  v_actor_id UUID;
  v_has_future_session BOOLEAN := false;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: only active application users can move leads to Alumni.';
  END IF;
  v_actor_id := auth.uid();

  SELECT l.*, s.code as stage_code
  INTO v_lead
  FROM public.leads l
  JOIN public.pipeline_stages s ON s.id = l.pipeline_stage_id
  WHERE l.id = p_lead_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead % not found.', p_lead_id;
  END IF;

  SELECT id INTO v_alumni_stage_id FROM public.pipeline_stages WHERE code = 'alumni';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pipeline stage alumni not found.';
  END IF;

  -- Idempotent: already alumni
  IF v_lead.pipeline_stage_id = v_alumni_stage_id THEN
    RETURN jsonb_build_object(
      'success', true,
      'lead_id', p_lead_id,
      'stage', 'alumni',
      'changed', false,
      'message', 'Lead is already in Alumni stage.'
    );
  END IF;

  -- Safety context: check if lead has any future session scheduled
  SELECT EXISTS (
    SELECT 1 FROM public.enrollments e
    JOIN public.course_sessions s ON s.id = e.course_session_id
    WHERE e.lead_id = p_lead_id
      AND e.enrollment_status = 'confirmed'
      AND s.start_date > CURRENT_DATE
  ) INTO v_has_future_session;

  -- Update Lead
  UPDATE public.leads
  SET pipeline_stage_id = v_alumni_stage_id,
      updated_at = now()
  WHERE id = p_lead_id;

  -- Stage History
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
    v_alumni_stage_id,
    'alumni_transition',
    'user',
    v_actor_id
  );

  -- Activity Log
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
    'user',
    v_actor_id,
    'Lead promoted to Alumni.' || CASE WHEN v_has_future_session THEN ' (Note: Student has active future course session).' ELSE '' END,
    jsonb_build_object(
      'from_stage', v_lead.stage_code,
      'to_stage', 'alumni',
      'has_future_session', v_has_future_session,
      'note', p_note
    )
  );

  -- Automation Event
  INSERT INTO public.automation_events (
    event_type,
    lead_id,
    payload
  ) VALUES (
    'pipeline_stage_changed',
    p_lead_id,
    jsonb_build_object('from_stage', v_lead.stage_code, 'to_stage', 'alumni', 'reason', 'alumni_transition')
  );

  RETURN jsonb_build_object(
    'success', true,
    'lead_id', p_lead_id,
    'stage', 'alumni',
    'changed', true,
    'has_future_session', v_has_future_session
  );
END;
$$;


-- 9.9 High-Performance Aggregator: get_post_course_dashboard
CREATE OR REPLACE FUNCTION public.get_post_course_dashboard()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings RECORD;
  v_feedback_due_days INT;
  v_testimonial_due_days INT;

  -- KPIs
  v_completed_students_count INT := 0;
  v_followups_due_count INT := 0;
  v_followups_overdue_count INT := 0;
  v_feedback_pending_count INT := 0;
  v_feedback_received_count INT := 0;
  v_feedback_requested_count INT := 0;
  v_testimonials_received_count INT := 0;
  v_testimonials_requested_count INT := 0;
  v_testimonial_opps_count INT := 0;
  v_next_course_opps_count INT := 0;
  v_repeat_students_count INT := 0;
  v_alumni_students_count INT := 0;
  v_total_confirmed_leads_count INT := 0;

  v_feedback_response_rate NUMERIC := NULL;
  v_testimonial_response_rate NUMERIC := NULL;
  v_repeat_student_rate NUMERIC := NULL;

  -- Data Lists
  v_followup_queue JSONB := '[]'::jsonb;
  v_testimonial_opportunities JSONB := '[]'::jsonb;
  v_next_course_opportunities JSONB := '[]'::jsonb;
  v_alumni_directory JSONB := '[]'::jsonb;
  v_needs_attention JSONB := '[]'::jsonb;
BEGIN
  IF NOT public.is_active_app_user() THEN
    RAISE EXCEPTION 'Unauthorized: only active application users can view post-course dashboard.';
  END IF;

  SELECT 
    COALESCE(post_course_feedback_due_days, 7) AS feedback_due_days,
    COALESCE(testimonial_request_due_days, 5) AS testimonial_due_days
  INTO v_settings
  FROM public.app_settings
  LIMIT 1;

  v_feedback_due_days := COALESCE(v_settings.feedback_due_days, 7);
  v_testimonial_due_days := COALESCE(v_settings.testimonial_due_days, 5);

  -- 1. Completed Students Count
  SELECT count(DISTINCT e.lead_id) INTO v_completed_students_count
  FROM public.course_participations p
  JOIN public.enrollments e ON e.id = p.enrollment_id
  WHERE p.completion_status = 'completed';

  -- 2. Follow-Ups Due & Overdue
  SELECT 
    count(*) FILTER (WHERE followup_status = 'pending'),
    count(*) FILTER (WHERE followup_status = 'pending' AND followup_due_at < now())
  INTO v_followups_due_count, v_followups_overdue_count
  FROM public.post_course_engagements;

  -- 3. Feedback Counts
  SELECT 
    count(*) FILTER (WHERE feedback_status = 'requested'),
    count(*) FILTER (WHERE feedback_status = 'received'),
    count(*) FILTER (WHERE feedback_status IN ('requested', 'received', 'declined'))
  INTO v_feedback_pending_count, v_feedback_received_count, v_feedback_requested_count
  FROM public.post_course_engagements;

  IF v_feedback_requested_count > 0 THEN
    v_feedback_response_rate := ROUND((v_feedback_received_count::numeric / v_feedback_requested_count::numeric) * 100, 1);
  END IF;

  -- 4. Testimonial Counts
  SELECT 
    count(*) FILTER (WHERE testimonial_status = 'received'),
    count(*) FILTER (WHERE testimonial_status IN ('requested', 'received', 'declined'))
  INTO v_testimonials_received_count, v_testimonials_requested_count
  FROM public.post_course_engagements;

  IF v_testimonials_requested_count > 0 THEN
    v_testimonial_response_rate := ROUND((v_testimonials_received_count::numeric / v_testimonials_requested_count::numeric) * 100, 1);
  END IF;

  -- 5. Repeat Students & Total Confirmed Leads
  WITH lead_confirmed_counts AS (
    SELECT lead_id, count(*) as conf_count
    FROM public.enrollments
    WHERE enrollment_status = 'confirmed'
    GROUP BY lead_id
  )
  SELECT 
    count(*) FILTER (WHERE conf_count >= 2),
    count(*)
  INTO v_repeat_students_count, v_total_confirmed_leads_count
  FROM lead_confirmed_counts;

  IF v_total_confirmed_leads_count > 0 THEN
    v_repeat_student_rate := ROUND((v_repeat_students_count::numeric / v_total_confirmed_leads_count::numeric) * 100, 1);
  END IF;

  -- 6. Alumni Count
  SELECT count(*) INTO v_alumni_students_count
  FROM public.leads l
  JOIN public.pipeline_stages s ON s.id = l.pipeline_stage_id
  WHERE s.code = 'alumni';

  -- 7. Testimonial Opportunities Count
  -- Criterion: Course completed + Feedback received + Testimonial not_requested
  SELECT count(*) INTO v_testimonial_opps_count
  FROM public.post_course_engagements eng
  WHERE eng.feedback_status = 'received'
    AND eng.testimonial_status = 'not_requested';

  -- 8. Next Course Opportunities Count
  -- Criterion: Lead has active course interest AND has no confirmed enrollment for that course
  SELECT count(*) INTO v_next_course_opps_count
  FROM public.lead_course_interests i
  WHERE i.status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM public.enrollments e
      WHERE e.lead_id = i.lead_id
        AND e.course_id = i.course_id
        AND e.enrollment_status = 'confirmed'
    );

  -- 9. Follow-Up Queue List
  SELECT jsonb_agg(sub) INTO v_followup_queue
  FROM (
    SELECT 
      eng.id AS engagement_id,
      eng.enrollment_id,
      eng.lead_id,
      l.first_name || ' ' || l.last_name AS student_name,
      l.email AS student_email,
      l.phone_e164 AS student_phone,
      l.contact_preference,
      e.course_name_snapshot AS course_name,
      s.code AS session_code,
      s.title AS session_title,
      p.completed_at,
      eng.followup_status,
      eng.followup_due_at,
      (eng.followup_due_at < now()) AS is_overdue,
      eng.notes
    FROM public.post_course_engagements eng
    JOIN public.enrollments e ON e.id = eng.enrollment_id
    JOIN public.leads l ON l.id = eng.lead_id
    LEFT JOIN public.course_participations p ON p.enrollment_id = e.id
    LEFT JOIN public.course_sessions s ON s.id = e.course_session_id
    ORDER BY eng.followup_due_at ASC
    LIMIT 100
  ) sub;

  -- 10. Testimonial Opportunities List
  SELECT jsonb_agg(sub) INTO v_testimonial_opportunities
  FROM (
    SELECT 
      eng.id AS engagement_id,
      eng.enrollment_id,
      eng.lead_id,
      l.first_name || ' ' || l.last_name AS student_name,
      l.email AS student_email,
      e.course_name_snapshot AS course_name,
      s.code AS session_code,
      eng.feedback_status,
      eng.feedback_received_at,
      eng.feedback_notes,
      eng.testimonial_status,
      eng.testimonial_consent_status,
      eng.testimonial_notes
    FROM public.post_course_engagements eng
    JOIN public.enrollments e ON e.id = eng.enrollment_id
    JOIN public.leads l ON l.id = eng.lead_id
    LEFT JOIN public.course_sessions s ON s.id = e.course_session_id
    WHERE eng.feedback_status = 'received'
       OR eng.testimonial_status IN ('requested', 'received')
    ORDER BY eng.feedback_received_at DESC NULLS LAST
    LIMIT 50
  ) sub;

  -- 11. Next Course Opportunities List
  SELECT jsonb_agg(sub) INTO v_next_course_opportunities
  FROM (
    SELECT 
      i.id AS interest_id,
      i.lead_id,
      l.first_name || ' ' || l.last_name AS student_name,
      l.email AS student_email,
      l.phone_e164 AS student_phone,
      l.contact_preference,
      c.id AS course_id,
      c.name AS target_course_name,
      c.default_price,
      i.source,
      i.status,
      i.notes,
      i.created_at,
      prev_e.course_name_snapshot AS completed_course_name
    FROM public.lead_course_interests i
    JOIN public.leads l ON l.id = i.lead_id
    JOIN public.courses c ON c.id = i.course_id
    LEFT JOIN public.enrollments prev_e ON prev_e.id = i.source_enrollment_id
    WHERE i.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM public.enrollments e
        WHERE e.lead_id = i.lead_id
          AND e.course_id = i.course_id
          AND e.enrollment_status = 'confirmed'
      )
    ORDER BY i.created_at DESC
    LIMIT 50
  ) sub;

  -- 12. Alumni Directory List
  SELECT jsonb_agg(sub) INTO v_alumni_directory
  FROM (
    SELECT 
      l.id AS lead_id,
      l.first_name || ' ' || l.last_name AS student_name,
      l.email AS student_email,
      l.phone_e164 AS student_phone,
      l.contact_preference,
      l.created_at AS member_since,
      count(e.id) AS confirmed_enrollments_count,
      (count(e.id) >= 2) AS is_repeat_student,
      COALESCE(sum(e.agreed_amount), 0) AS total_spend,
      max(p.completed_at) AS last_completed_date,
      l.course_interest AS current_interest
    FROM public.leads l
    JOIN public.pipeline_stages s ON s.id = l.pipeline_stage_id
    LEFT JOIN public.enrollments e ON e.lead_id = l.id AND e.enrollment_status = 'confirmed'
    LEFT JOIN public.course_participations p ON p.enrollment_id = e.id AND p.completion_status = 'completed'
    WHERE s.code = 'alumni'
    GROUP BY l.id, l.first_name, l.last_name, l.email, l.phone_e164, l.contact_preference, l.created_at, l.course_interest
    ORDER BY last_completed_date DESC NULLS LAST
    LIMIT 100
  ) sub;

  -- 13. Needs Attention Engine (Block 5 Server-Side Codes)
  SELECT jsonb_agg(sub) INTO v_needs_attention
  FROM (
    -- A) POST_COURSE_FOLLOWUP_OVERDUE
    SELECT 
      'POST_COURSE_FOLLOWUP_OVERDUE' AS reason_code,
      'warning' AS severity,
      eng.id AS engagement_id,
      eng.lead_id,
      l.first_name || ' ' || l.last_name AS student_name,
      e.course_name_snapshot AS course_name,
      'Follow-up overdue by ' || ROUND(EXTRACT(EPOCH FROM (now() - eng.followup_due_at)) / 86400)::int || ' days.' AS message,
      eng.followup_due_at AS detected_at
    FROM public.post_course_engagements eng
    JOIN public.enrollments e ON e.id = eng.enrollment_id
    JOIN public.leads l ON l.id = eng.lead_id
    WHERE eng.followup_status = 'pending' AND eng.followup_due_at < now()

    UNION ALL

    -- B) FEEDBACK_PENDING
    SELECT 
      'FEEDBACK_PENDING' AS reason_code,
      'info' AS severity,
      eng.id AS engagement_id,
      eng.lead_id,
      l.first_name || ' ' || l.last_name AS student_name,
      e.course_name_snapshot AS course_name,
      'Feedback requested ' || ROUND(EXTRACT(EPOCH FROM (now() - eng.feedback_requested_at)) / 86400)::int || ' days ago. Pending student response.' AS message,
      eng.feedback_requested_at AS detected_at
    FROM public.post_course_engagements eng
    JOIN public.enrollments e ON e.id = eng.enrollment_id
    JOIN public.leads l ON l.id = eng.lead_id
    WHERE eng.feedback_status = 'requested'
      AND eng.feedback_requested_at + (v_feedback_due_days || ' days')::interval < now()

    UNION ALL

    -- C) TESTIMONIAL_REQUEST_DUE
    SELECT 
      'TESTIMONIAL_REQUEST_DUE' AS reason_code,
      'info' AS severity,
      eng.id AS engagement_id,
      eng.lead_id,
      l.first_name || ' ' || l.last_name AS student_name,
      e.course_name_snapshot AS course_name,
      'Student provided feedback. Testimonial outreach recommended.' AS message,
      eng.feedback_received_at AS detected_at
    FROM public.post_course_engagements eng
    JOIN public.enrollments e ON e.id = eng.enrollment_id
    JOIN public.leads l ON l.id = eng.lead_id
    WHERE eng.feedback_status = 'received'
      AND eng.testimonial_status = 'not_requested'

    UNION ALL

    -- D) NEXT_COURSE_OPPORTUNITY
    SELECT 
      'NEXT_COURSE_OPPORTUNITY' AS reason_code,
      'info' AS severity,
      i.id AS engagement_id,
      i.lead_id,
      l.first_name || ' ' || l.last_name AS student_name,
      c.name AS course_name,
      'Student expressed interest in ' || c.name || '. Commercial outreach pending.' AS message,
      i.created_at AS detected_at
    FROM public.lead_course_interests i
    JOIN public.leads l ON l.id = i.lead_id
    JOIN public.courses c ON c.id = i.course_id
    WHERE i.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM public.enrollments e
        WHERE e.lead_id = i.lead_id
          AND e.course_id = i.course_id
          AND e.enrollment_status = 'confirmed'
      )
  ) sub;

  RETURN jsonb_build_object(
    'kpis', jsonb_build_object(
      'completed_students_count', v_completed_students_count,
      'followups_due_count', v_followups_due_count,
      'followups_overdue_count', v_followups_overdue_count,
      'feedback_pending_count', v_feedback_pending_count,
      'feedback_received_count', v_feedback_received_count,
      'testimonials_received_count', v_testimonials_received_count,
      'testimonial_opportunities_count', v_testimonial_opps_count,
      'next_course_opportunities_count', v_next_course_opps_count,
      'repeat_students_count', v_repeat_students_count,
      'alumni_students_count', v_alumni_students_count,
      'feedback_response_rate', v_feedback_response_rate,
      'testimonial_response_rate', v_testimonial_response_rate,
      'repeat_student_rate', v_repeat_student_rate
    ),
    'followup_queue', COALESCE(v_followup_queue, '[]'::jsonb),
    'testimonial_opportunities', COALESCE(v_testimonial_opportunities, '[]'::jsonb),
    'next_course_opportunities', COALESCE(v_next_course_opportunities, '[]'::jsonb),
    'alumni_directory', COALESCE(v_alumni_directory, '[]'::jsonb),
    'needs_attention', COALESCE(v_needs_attention, '[]'::jsonb)
  );
END;
$$;
